'use strict';

/**
 * AGENT 6 — ANALYTICS & OPTIMIZATION
 * Monitors performance, kills underperformers, scales winners, generates reports.
 * Runs every 6 hours.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { withRetry, sleep } = require('../lib/rate-limiter');
const { generateJSON, generateText } = require('../lib/claude-client');

const AGENT_NAME = 'analytics-optimization';
const LOOP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const REPORTS_DIR = path.resolve(__dirname, '../reports');

// Optimization thresholds
const NO_SALE_VIEWS_THRESHOLD = 500;
const NO_SALE_DAYS_THRESHOLD = 7;
const ROAS_PAUSE_META_THRESHOLD = 1.0;
const META_MIN_SPEND_FOR_PAUSE = 10.0;
const ROAS_SCALE_THRESHOLD = 3.0;
const META_SCALE_INCREMENT = 2.0;
const META_BUDGET_CAP = 15.0;
const HIGH_CONVERSION_THRESHOLD = 0.05;
const WINNING_THEME_MIN_LISTINGS = 3;

// ── Etsy Stats ────────────────────────────────────────────────────────────────

async function fetchEtsyStats(shopId) {
  try {
    const { data } = await withRetry(
      () => axios.get(
        `https://openapi.etsy.com/v3/application/shops/${shopId}/stats`,
        {
          headers: {
            Authorization: `Bearer ${process.env.ETSY_ACCESS_TOKEN}`,
            'x-api-key': process.env.ETSY_API_KEY,
          },
          params: { unit: 'day', limit: 7 },
          timeout: 20_000,
        }
      ),
      { maxAttempts: 3, baseDelayMs: 3000 }
    );
    return data;
  } catch (err) {
    return null; // stats are best-effort
  }
}

async function fetchListingStats(shopId, listingId) {
  try {
    const { data } = await withRetry(
      () => axios.get(
        `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/${listingId}/stats`,
        {
          headers: {
            'x-api-key': process.env.ETSY_API_KEY,
            Authorization: `Bearer ${process.env.ETSY_ACCESS_TOKEN}`,
          },
          timeout: 15_000,
        }
      ),
      { maxAttempts: 2, baseDelayMs: 2000 }
    );
    return data;
  } catch { return null; }
}

// ── Optimization Actions ──────────────────────────────────────────────────────

async function refreshListingTitleTags(listing, log) {
  log.info(`Refreshing SEO for underperforming listing ${listing.etsy_listing_id}`);

  const system = 'You are an Etsy SEO expert. Return valid JSON only.';
  const user = `Listing "${listing.title}" has 500+ views but no sales. Create improved SEO.
Return JSON: { "title": "new title under 140 chars", "tags": ["13", "new", "tags"] }`;

  const content = await generateJSON(system, user);
  const shopId = process.env.ETSY_SHOP_ID;

  await withRetry(
    () => axios.put(
      `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/${listing.etsy_listing_id}`,
      {
        title: content.title?.slice(0, 140),
        tags: content.tags?.slice(0, 13),
        price: listing.retail_price * 0.9, // 10% price reduction
      },
      {
        headers: {
          'x-api-key': process.env.ETSY_API_KEY,
          Authorization: `Bearer ${process.env.ETSY_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    ),
    { maxAttempts: 3, baseDelayMs: 2000 }
  );

  log.info(`Listing ${listing.etsy_listing_id} SEO updated and price reduced 10%`);
}

async function pauseMetaAd(campaign, log) {
  if (!process.env.META_ACCESS_TOKEN || !campaign.meta?.campaign_id) return;

  try {
    await withRetry(
      () => axios.post(
        `https://graph.facebook.com/v21.0/${campaign.meta.campaign_id}`,
        { status: 'PAUSED', access_token: process.env.META_ACCESS_TOKEN },
        { timeout: 10_000 }
      ),
      { maxAttempts: 3, baseDelayMs: 2000 }
    );
    log.info(`Meta campaign ${campaign.meta.campaign_id} paused (low ROAS)`);
  } catch (err) {
    log.warn('Could not pause Meta campaign', { error: err.message });
  }
}

async function increaseMetaBudget(campaign, newBudget, log) {
  if (!process.env.META_ACCESS_TOKEN || !campaign.meta?.adset_id) return;

  try {
    await withRetry(
      () => axios.post(
        `https://graph.facebook.com/v21.0/${campaign.meta.adset_id}`,
        {
          daily_budget: Math.round(newBudget * 100),
          access_token: process.env.META_ACCESS_TOKEN,
        },
        { timeout: 10_000 }
      ),
      { maxAttempts: 3, baseDelayMs: 2000 }
    );
    log.info(`Meta adset ${campaign.meta.adset_id} budget increased to $${newBudget}/day`);
  } catch (err) {
    log.warn('Could not increase Meta budget', { error: err.message });
  }
}

// ── Report Generation ─────────────────────────────────────────────────────────

function generateReportMarkdown(state, stats, listingMetrics, date) {
  const totalRevenue = listingMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalAdSpend = state.ad_campaigns.reduce((s, c) => s + (c.meta?.spend || 0), 0) +
                       state.ad_campaigns.length * LOOP_INTERVAL_MS / 3600_000 * 1.5; // approx Etsy ad spend
  const netProfit = totalRevenue - totalAdSpend;

  const sorted = [...listingMetrics].sort((a, b) => b.revenue - a.revenue);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();

  const lines = [
    `# Daily Performance Report — ${date}`,
    '',
    `## Summary`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Revenue | $${totalRevenue.toFixed(2)} |`,
    `| Total Ad Spend | $${totalAdSpend.toFixed(2)} |`,
    `| Net Profit | $${netProfit.toFixed(2)} |`,
    `| Active Listings | ${state.etsy_listings.filter((l) => l.status === 'active').length} |`,
    `| Designs in Queue | ${state.design_queue.length} |`,
    '',
    `## Top 5 Listings`,
    '| Title | Views | Sales | Revenue | CVR |',
    '|-------|-------|-------|---------|-----|',
    ...top5.map((m) => `| ${m.title?.slice(0, 40)} | ${m.views} | ${m.sales} | $${m.revenue.toFixed(2)} | ${(m.conversionRate * 100).toFixed(1)}% |`),
    '',
    `## Bottom 5 Listings`,
    '| Title | Views | Sales | Revenue |',
    '|-------|-------|-------|---------|',
    ...bottom5.map((m) => `| ${m.title?.slice(0, 40)} | ${m.views} | ${m.sales} | $${m.revenue.toFixed(2)} |`),
    '',
    `## Recommended Actions`,
    ...listingMetrics.filter((m) => m.recommendations?.length).flatMap((m) =>
      m.recommendations.map((r) => `- [${m.title?.slice(0, 30)}] ${r}`)
    ),
    '',
    `_Generated at ${new Date().toISOString()}_`,
  ];

  return lines.join('\n');
}

// ── Main Analysis ─────────────────────────────────────────────────────────────

async function runOnce(log) {
  log.info('Starting analytics cycle');
  const state = readState();
  const shopId = process.env.ETSY_SHOP_ID;

  const shopStats = await fetchEtsyStats(shopId);
  log.info('Shop stats fetched', { available: !!shopStats });

  const listingMetrics = [];

  for (const listing of state.etsy_listings.filter((l) => l.status === 'active').slice(0, 30)) {
    const lStats = await fetchListingStats(shopId, listing.etsy_listing_id);
    await sleep(300); // gentle rate-limiting

    const views = lStats?.views ?? listing.views ?? 0;
    const sales = lStats?.orders ?? listing.sales ?? 0;
    const revenue = sales * (listing.retail_price || 0);
    const conversionRate = views > 0 ? sales / views : 0;

    const campaign = state.ad_campaigns.find((c) => c.listing_id === listing.etsy_listing_id);
    const metaSpend = campaign?.meta?.spend || 0;
    const metaRevenue = campaign?.meta?.revenue || 0;
    const roas = metaSpend > 0 ? metaRevenue / metaSpend : 0;

    const createdAt = new Date(listing.created_at).getTime();
    const ageDays = (Date.now() - createdAt) / (24 * 3600_000);

    const recommendations = [];

    // Rule 1: >500 views, 0 sales, >7 days → refresh SEO + reduce price
    if (views >= NO_SALE_VIEWS_THRESHOLD && sales === 0 && ageDays >= NO_SALE_DAYS_THRESHOLD) {
      recommendations.push('Refresh title/tags, reduce price 10%');
      try {
        await refreshListingTitleTags(listing, log);
      } catch (err) {
        log.warn('SEO refresh failed', { error: err.message });
      }
    }

    // Rule 2: Meta ROAS < 1.0 after $10 spend → pause Meta ads
    if (campaign?.meta?.campaign_id && metaSpend >= META_MIN_SPEND_FOR_PAUSE && roas < ROAS_PAUSE_META_THRESHOLD) {
      recommendations.push('Pause Meta ads (ROAS below 1.0)');
      await pauseMetaAd(campaign, log);
      updateState((s) => {
        const c = s.ad_campaigns.find((ac) => ac.listing_id === listing.etsy_listing_id);
        if (c?.meta) c.meta.status = 'paused';
        return s;
      });
    }

    // Rule 3: ROAS > 3.0 → scale Meta budget
    if (campaign?.meta?.campaign_id && roas >= ROAS_SCALE_THRESHOLD && metaSpend > 0) {
      const currentBudget = campaign.meta.daily_budget || META_ADS_DAILY_BUDGET;
      const newBudget = Math.min(currentBudget + META_SCALE_INCREMENT, META_BUDGET_CAP);
      if (newBudget > currentBudget) {
        recommendations.push(`Scale Meta budget to $${newBudget}/day`);
        await increaseMetaBudget(campaign, newBudget, log);
        updateState((s) => {
          const c = s.ad_campaigns.find((ac) => ac.listing_id === listing.etsy_listing_id);
          if (c?.meta) c.meta.daily_budget = newBudget;
          return s;
        });
      }
    }

    // Rule 4: Conversion rate > 5% → queue more designs on this theme
    if (conversionRate >= HIGH_CONVERSION_THRESHOLD && sales > 0) {
      recommendations.push('High CVR — queue more design variations');
      updateState((s) => {
        const existing = s.trends.find((t) => t.keyword === listing.keyword);
        if (!existing) {
          s.trends.unshift({
            keyword: listing.keyword,
            score: 9.5,
            product_types: [listing.blueprint || 't-shirt', 'mug', 'tote bag'],
            style_notes: 'proven winner — generate more variations',
            timestamp: new Date().toISOString(),
            priority: true,
          });
        }
        return s;
      });
    }

    listingMetrics.push({
      etsy_listing_id: listing.etsy_listing_id,
      title: listing.title,
      keyword: listing.keyword,
      views, sales, revenue, conversionRate, roas,
      metaSpend, ageDays,
      recommendations,
    });
  }

  // Rule 5: theme with 3+ winning listings → request 10 more variations
  const themeWins = {};
  for (const m of listingMetrics) {
    if (m.sales > 0) themeWins[m.keyword] = (themeWins[m.keyword] || 0) + 1;
  }
  for (const [keyword, count] of Object.entries(themeWins)) {
    if (count >= WINNING_THEME_MIN_LISTINGS) {
      log.info(`Theme "${keyword}" has ${count} winning listings — queuing bulk generation`);
      updateState((s) => {
        for (let i = 0; i < 10; i++) {
          s.trends.unshift({
            keyword: `${keyword} variation ${i + 1}`,
            score: 9.0,
            product_types: ['t-shirt', 'mug', 'tote bag'],
            style_notes: `proven theme variation — unique interpretation ${i + 1}`,
            timestamp: new Date().toISOString(),
            priority: true,
          });
        }
        return s;
      });
    }
  }

  // Update analytics summary
  const totalRevenue = listingMetrics.reduce((s, m) => s + m.revenue, 0);
  const totalSales = listingMetrics.reduce((s, m) => s + m.sales, 0);

  updateState((s) => {
    s.etsy_listings = s.etsy_listings.map((l) => {
      const m = listingMetrics.find((x) => x.etsy_listing_id === l.etsy_listing_id);
      if (m) {
        l.views = m.views;
        l.sales = m.sales;
        l.revenue = m.revenue;
      }
      return l;
    });

    s.analytics = {
      ...s.analytics,
      last_run: new Date().toISOString(),
      total_revenue: totalRevenue,
      total_sales: totalSales,
      active_listings: s.etsy_listings.filter((l) => l.status === 'active').length,
    };
    return s;
  });

  // Write daily report
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `report_${date}.md`);
  const report = generateReportMarkdown(readState(), shopStats, listingMetrics, date);
  fs.writeFileSync(reportPath, report, 'utf8');
  log.info(`Report written to ${reportPath}`);
}

async function run() {
  const log = createLogger(AGENT_NAME);
  log.info('Agent started');

  const heartbeatTimer = setInterval(() => log.heartbeat(), HEARTBEAT_INTERVAL_MS);

  while (true) {
    try {
      await runOnce(log);
    } catch (err) {
      log.error('Cycle failed', { error: err.message });
      appendError(AGENT_NAME, err.message);
    }
    log.info(`Sleeping 6 hours until next cycle`);
    await sleep(LOOP_INTERVAL_MS);
  }

  clearInterval(heartbeatTimer);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[${AGENT_NAME}] Fatal:`, err);
    process.exit(1);
  });
}

module.exports = { run };
