'use strict';

/**
 * AGENT 1 — TREND SCOUT
 * Researches trending Etsy searches, Google Trends, and Reddit to feed the design pipeline.
 * Loops every 30 minutes.
 */

const axios = require('axios');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { withRetry, sleep } = require('../lib/rate-limiter');

const AGENT_NAME = 'trend-scout';
const LOOP_INTERVAL_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const HIGH_MARGIN_PRODUCTS = ['t-shirt', 'mug', 'tote bag', 'phone case', 'wall art', 'hoodie'];

const PRODUCT_STYLE_MAP = {
  'cottagecore': { products: ['t-shirt', 'mug', 'tote bag'], style: 'earthy tones, hand-drawn illustration, botanical, whimsical' },
  'dark academia': { products: ['t-shirt', 'hoodie', 'wall art'], style: 'moody dark tones, vintage library aesthetic, gothic serif typography' },
  'retro vintage': { products: ['t-shirt', 'mug', 'wall art'], style: 'faded colors, distressed texture, bold retro typography' },
  'minimalist': { products: ['t-shirt', 'mug', 'phone case'], style: 'clean white space, simple lines, sans-serif type, monochrome' },
  'mental health': { products: ['t-shirt', 'tote bag', 'mug'], style: 'soft pastels, encouraging typography, heart motifs' },
  'cat lover': { products: ['t-shirt', 'mug', 'phone case', 'tote bag'], style: 'cute illustrated cats, playful colors, modern flat design' },
  'plant parent': { products: ['t-shirt', 'mug', 'tote bag', 'wall art'], style: 'botanical green tones, hand-drawn plants, earthy' },
  'mushroom': { products: ['t-shirt', 'mug', 'tote bag'], style: 'cottagecore mushroom illustration, earthy browns and greens' },
  'moon phases': { products: ['t-shirt', 'wall art', 'phone case'], style: 'celestial, mystical, dark navy with gold accents' },
  'beach summer': { products: ['t-shirt', 'mug', 'tote bag', 'phone case'], style: 'bright coastal colors, wave motifs, laid-back typography' },
};

const SEASONAL_KEYWORDS = {
  0: ['new year', 'resolution', 'winter cozy'],
  1: ['valentines day', 'love hearts', 'galentines'],
  2: ['st patricks day', 'spring', 'luck'],
  3: ['easter', 'spring flowers', 'earth day'],
  4: ['mothers day', 'graduation', 'spring'],
  5: ['fathers day', 'summer', 'pride month'],
  6: ['summer beach', 'fourth of july', 'vacation'],
  7: ['back to school', 'summer end', 'sunflower'],
  8: ['fall autumn', 'pumpkin spice', 'halloween early'],
  9: ['halloween', 'fall leaves', 'cozy autumn'],
  10: ['thanksgiving', 'friendsgiving', 'fall harvest'],
  11: ['christmas', 'holiday gifts', 'winter wonderland', 'hanukkah', 'new year eve'],
};

async function fetchEtsyTrending() {
  // Etsy's trending page is rendered client-side, so we use their search suggestions API
  try {
    const { data } = await withRetry(() =>
      axios.get('https://www.etsy.com/api/v3/ajax/bespoke/member/listings/recommendations', {
        params: { limit: 20 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EtsyTrendBot/1.0)',
          'Accept': 'application/json',
        },
        timeout: 15_000,
      })
    , { maxAttempts: 3, baseDelayMs: 2000 });
    return data?.results?.map((r) => r?.listing?.title).filter(Boolean) || [];
  } catch {
    // Fallback: return curated high-volume Etsy search terms for current season
    const month = new Date().getMonth();
    return [...(SEASONAL_KEYWORDS[month] || []), ...Object.keys(PRODUCT_STYLE_MAP)].slice(0, 15);
  }
}

async function fetchGoogleTrends() {
  try {
    const { data } = await withRetry(() =>
      axios.get('https://trends.google.com/trends/trendingsearches/daily', {
        params: { geo: 'US', hl: 'en-US', ns: 15 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TrendBot/1.0)',
          'Accept': 'application/json',
        },
        timeout: 15_000,
      })
    , { maxAttempts: 3, baseDelayMs: 2000 });

    // Google Trends daily JSON — parse trendingStories
    if (typeof data === 'string') {
      const jsonStr = data.replace(/^[^[]+/, '');
      const parsed = JSON.parse(jsonStr);
      const stories = parsed?.[1]?.[0]?.[0]?.[0] || [];
      return stories.slice(0, 20).map((s) => s?.[0]).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchRedditTrends() {
  const subreddits = ['printOnDemand', 'Etsy', 'entrepreneur'];
  const keywords = [];

  for (const sub of subreddits) {
    try {
      const { data } = await withRetry(() =>
        axios.get(`https://www.reddit.com/r/${sub}/hot.json`, {
          params: { limit: 25 },
          headers: { 'User-Agent': 'EtsyTrendBot/1.0 (research bot)' },
          timeout: 15_000,
        })
      , { maxAttempts: 3, baseDelayMs: 3000 });

      const posts = data?.data?.children || [];
      for (const post of posts) {
        const title = post?.data?.title || '';
        // Extract product/design keywords from post titles
        const words = title.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
        keywords.push(...words);
      }
      await sleep(1500); // be kind to Reddit rate limits
    } catch { /* ignore per-subreddit failures */ }
  }

  // Count keyword frequency and return top phrases
  const freq = {};
  for (const w of keywords) {
    if (!['that', 'with', 'this', 'from', 'have', 'been', 'they', 'what', 'when', 'want', 'just', 'like', 'your', 'need', 'does', 'some', 'than', 'into', 'more', 'also'].includes(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
}

function scoreTrend(keyword, googleTrends, redditKeywords) {
  let score = 5.0;

  // Google Trends signal
  if (googleTrends.some((t) => t && keyword.toLowerCase().includes(t.toLowerCase().slice(0, 6)))) score += 1.5;

  // Reddit signal
  const redditHits = redditKeywords.filter((r) => keyword.toLowerCase().includes(r) || r.includes(keyword.toLowerCase().slice(0, 5)));
  score += Math.min(redditHits.length * 0.5, 1.5);

  // Seasonal bonus
  const month = new Date().getMonth();
  const seasonal = SEASONAL_KEYWORDS[month] || [];
  if (seasonal.some((s) => keyword.toLowerCase().includes(s.split(' ')[0]))) score += 1.0;

  // High margin product match bonus
  const styleEntry = Object.entries(PRODUCT_STYLE_MAP).find(([k]) => keyword.toLowerCase().includes(k));
  if (styleEntry) score += 0.5;

  return Math.min(Math.round(score * 10) / 10, 10);
}

function inferStyleNotes(keyword) {
  const lower = keyword.toLowerCase();
  for (const [key, val] of Object.entries(PRODUCT_STYLE_MAP)) {
    if (lower.includes(key)) return { style: val.style, products: val.products };
  }
  return {
    style: 'modern clean design, high contrast, bold typography',
    products: HIGH_MARGIN_PRODUCTS.slice(0, 3),
  };
}

function buildTrendObject(keyword, googleTrends, redditKeywords) {
  const { style, products } = inferStyleNotes(keyword);
  return {
    keyword,
    score: scoreTrend(keyword, googleTrends, redditKeywords),
    product_types: products,
    style_notes: style,
    timestamp: new Date().toISOString(),
  };
}

function isDuplicate(keyword, existingTrends) {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  return existingTrends.some(
    (t) => t.keyword.toLowerCase() === keyword.toLowerCase() &&
           new Date(t.timestamp).getTime() > cutoff
  );
}

async function runOnce(log) {
  log.info('Starting trend research cycle');

  const [etsyTerms, googleTrends, redditKeywords] = await Promise.allSettled([
    fetchEtsyTrending(),
    fetchGoogleTrends(),
    fetchRedditTrends(),
  ]);

  const etsy = etsyTerms.status === 'fulfilled' ? etsyTerms.value : [];
  const google = googleTrends.status === 'fulfilled' ? googleTrends.value : [];
  const reddit = redditKeywords.status === 'fulfilled' ? redditKeywords.value : [];

  log.info(`Raw data: etsy=${etsy.length}, google=${google.length}, reddit=${reddit.length}`);

  // Deduplicate raw keywords and combine
  const allKeywords = [...new Set([...etsy, ...Object.keys(PRODUCT_STYLE_MAP)])].slice(0, 30);

  // Add seasonal keywords
  const month = new Date().getMonth();
  const seasonal = (SEASONAL_KEYWORDS[month] || []).map((k) => `${k} gift`);
  allKeywords.push(...seasonal);

  updateState((state) => {
    const newTrends = [];
    for (const keyword of allKeywords) {
      if (!keyword || keyword.length < 4) continue;
      if (isDuplicate(keyword, state.trends)) continue;
      newTrends.push(buildTrendObject(keyword, google, reddit));
    }

    // Sort by score descending, take top 10
    newTrends.sort((a, b) => b.score - a.score);
    const top10 = newTrends.slice(0, 10);

    if (top10.length > 0) {
      log.info(`Adding ${top10.length} new trends`, { keywords: top10.map((t) => t.keyword) });
    }

    // Keep trends from last 48h only
    const cutoff = Date.now() - 2 * DEDUP_WINDOW_MS;
    const filtered = state.trends.filter((t) => new Date(t.timestamp).getTime() > cutoff);

    state.trends = [...top10, ...filtered].slice(0, 100);
    return state;
  });
}

async function run() {
  const log = createLogger(AGENT_NAME);
  log.info('Agent started');

  // Heartbeat loop
  const heartbeatTimer = setInterval(() => log.heartbeat(), HEARTBEAT_INTERVAL_MS);

  while (true) {
    try {
      await runOnce(log);
    } catch (err) {
      log.error('Cycle failed', { error: err.message });
      appendError(AGENT_NAME, err.message);
    }
    log.info(`Sleeping ${LOOP_INTERVAL_MS / 60000} minutes until next cycle`);
    await sleep(LOOP_INTERVAL_MS);
  }

  // unreachable — included for clarity
  clearInterval(heartbeatTimer);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[${AGENT_NAME}] Fatal error:`, err);
    process.exit(1);
  });
}

module.exports = { run };
