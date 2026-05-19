'use strict';

/**
 * AGENT 5 — AD CAMPAIGN
 * Runs automated Etsy Ads and social media promotion for new listings.
 * Polls state.etsy_listings every hour.
 */

const axios = require('axios');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { RateLimiter, withRetry, sleep } = require('../lib/rate-limiter');
const { generateJSON } = require('../lib/claude-client');

const AGENT_NAME = 'ad-campaign';
const POLL_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const PINTEREST_BASE = 'https://api.pinterest.com/v5';

// Etsy Ads starting budget (USD)
const ETSY_ADS_DAILY_BUDGET = 1.50;
const META_ADS_DAILY_BUDGET = 3.00;
const META_ADS_MAX_BUDGET = 15.00;
const META_ROAS_PAUSE_THRESHOLD = 1.5;

const metaLimiter = new RateLimiter(200, 3600_000);  // Meta: 200 req/hour
const pinterestLimiter = new RateLimiter(100, 60_000); // Pinterest: 100 req/min

// ── Etsy Ads ─────────────────────────────────────────────────────────────────

async function enableEtsyAds(listingId, log) {
  try {
    const shopId = process.env.ETSY_SHOP_ID;
    const { data } = await withRetry(
      () => axios.post(
        `https://openapi.etsy.com/v3/application/shops/${shopId}/ads`,
        { listing_id: listingId, daily_budget: ETSY_ADS_DAILY_BUDGET * 100 }, // in cents
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
    log.info(`Etsy Ads enabled for listing ${listingId}`, { budget: ETSY_ADS_DAILY_BUDGET });
    return { enabled: true, daily_budget: ETSY_ADS_DAILY_BUDGET, listing_id: listingId };
  } catch (err) {
    log.warn(`Could not enable Etsy Ads for listing ${listingId}`, { error: err.message });
    return { enabled: false, error: err.message };
  }
}

// ── Pinterest ─────────────────────────────────────────────────────────────────

async function generateAdCopy(platform, productType, keyword) {
  const system = 'You are a social media ad copywriter. Return valid JSON only.';
  const user = `Write ${platform} ad copy for a ${productType} with "${keyword}" design on Etsy.
Return JSON:
{
  "headline": "30 chars max for Facebook, catchy",
  "primary_text": "125 chars max, warm and enthusiastic, emphasize gift potential",
  "hashtags": ["relevant", "hashtags", "for", "platform"],
  "call_to_action": "short CTA phrase"
}`;

  return generateJSON(system, user);
}

async function createPinterestPin(listing, log) {
  if (!process.env.PINTEREST_ACCESS_TOKEN || !process.env.PINTEREST_BOARD_ID) {
    log.info('Pinterest not configured — skipping');
    return null;
  }

  try {
    const copy = await generateAdCopy('Pinterest', listing.blueprint || 'product', listing.keyword);
    const description = `${copy.primary_text}\n\n${copy.hashtags.map((h) => `#${h}`).join(' ')}`;

    await pinterestLimiter.acquire();
    const { data } = await withRetry(
      () => axios.post(
        `${PINTEREST_BASE}/pins`,
        {
          board_id: process.env.PINTEREST_BOARD_ID,
          title: listing.title?.slice(0, 100),
          description,
          link: listing.url,
          media_source: {
            source_type: 'image_url',
            url: `https://www.etsy.com/listing/${listing.etsy_listing_id}/images/1`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          timeout: 20_000,
        }
      ),
      { maxAttempts: 3, baseDelayMs: 3000 }
    );

    log.info(`Pinterest pin created: ${data.id}`);
    return { pin_id: data.id, impressions: 0, saves: 0 };
  } catch (err) {
    log.warn('Pinterest pin creation failed', { error: err.message });
    return { pin_id: null, error: err.message };
  }
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────

async function metaPost(path, params) {
  await metaLimiter.acquire();
  const { data } = await withRetry(
    () => axios.post(`${META_GRAPH_BASE}${path}`, params, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20_000,
    }),
    { maxAttempts: 3, baseDelayMs: 3000 }
  );
  return data;
}

async function createMetaAdCampaign(listing, log) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    log.info('Meta Ads not configured — skipping');
    return null;
  }

  const accountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  try {
    const copy = await generateAdCopy('Facebook', listing.blueprint || 'product', listing.keyword);

    // 1. Create campaign
    const campaign = await metaPost(`/act_${accountId}/campaigns`, {
      name: `Etsy - ${listing.keyword} - ${listing.blueprint}`,
      objective: 'OUTCOME_SALES',
      status: 'ACTIVE',
      special_ad_categories: [],
      access_token: accessToken,
    });

    // 2. Create ad set with targeting
    const adSet = await metaPost(`/act_${accountId}/adsets`, {
      name: `AdSet - ${listing.keyword}`,
      campaign_id: campaign.id,
      daily_budget: META_ADS_DAILY_BUDGET * 100, // in cents
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      targeting: {
        geo_locations: { countries: ['US', 'GB', 'CA', 'AU'] },
        age_min: 25,
        age_max: 55,
        interests: [
          { id: '6003263794354', name: listing.keyword },
          { id: '6003464426583', name: 'Online shopping' },
          { id: '6003657574443', name: 'Gift ideas' },
        ],
      },
      status: 'ACTIVE',
      access_token: accessToken,
    });

    // 3. Create ad creative
    const creative = await metaPost(`/act_${accountId}/adcreatives`, {
      name: `Creative - ${listing.keyword}`,
      object_story_spec: {
        page_id: process.env.META_PAGE_ID || accountId,
        link_data: {
          link: listing.url,
          message: copy.primary_text,
          name: copy.headline,
          call_to_action: { type: 'SHOP_NOW', value: { link: listing.url } },
        },
      },
      access_token: accessToken,
    });

    // 4. Create ad
    const ad = await metaPost(`/act_${accountId}/ads`, {
      name: `Ad - ${listing.keyword}`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'ACTIVE',
      access_token: accessToken,
    });

    log.info(`Meta campaign created`, { campaign_id: campaign.id, ad_id: ad.id });

    return {
      campaign_id: campaign.id,
      adset_id: adSet.id,
      ad_id: ad.id,
      daily_budget: META_ADS_DAILY_BUDGET,
      spend: 0,
      revenue: 0,
      roas: 0,
      status: 'active',
    };
  } catch (err) {
    log.warn('Meta campaign creation failed', { error: err.message });
    return { campaign_id: null, error: err.message };
  }
}

async function processListing(listing, log) {
  log.info(`Setting up campaigns for listing ${listing.etsy_listing_id} ("${listing.keyword}")`);

  const [etsyAds, pinterest, meta] = await Promise.allSettled([
    enableEtsyAds(listing.etsy_listing_id, log),
    createPinterestPin(listing, log),
    createMetaAdCampaign(listing, log),
  ]);

  return {
    listing_id: listing.etsy_listing_id,
    etsy_ads: etsyAds.status === 'fulfilled' ? etsyAds.value : { enabled: false, error: etsyAds.reason?.message },
    pinterest: pinterest.status === 'fulfilled' ? pinterest.value : { pin_id: null, error: pinterest.reason?.message },
    meta: meta.status === 'fulfilled' ? meta.value : { campaign_id: null, error: meta.reason?.message },
    created_at: new Date().toISOString(),
  };
}

async function runOnce(log) {
  const state = readState();

  const campaignedIds = new Set(state.ad_campaigns.map((c) => c.listing_id));
  const pending = state.etsy_listings.filter(
    (l) => l.status === 'active' && !campaignedIds.has(l.etsy_listing_id)
  );

  if (pending.length === 0) {
    log.info('No new listings to promote');
    return;
  }

  log.info(`Setting up campaigns for ${pending.length} listings`);

  for (const listing of pending.slice(0, 5)) { // max 5 per cycle
    try {
      const campaign = await processListing(listing, log);
      updateState((s) => {
        s.ad_campaigns.push(campaign);
        return s;
      });
    } catch (err) {
      log.error(`Campaign setup failed for listing ${listing.etsy_listing_id}`, { error: err.message });
      appendError(AGENT_NAME, err.message, { listing_id: listing.etsy_listing_id });
    }
    await sleep(5000);
  }
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
    log.info(`Sleeping ${POLL_INTERVAL_MS / 60000} minutes`);
    await sleep(POLL_INTERVAL_MS);
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
