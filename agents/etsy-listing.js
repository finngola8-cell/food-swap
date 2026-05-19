'use strict';

/**
 * AGENT 4 — ETSY LISTING
 * Pushes Printify products to Etsy as live listings with optimised SEO.
 * Polls state.printify_products every 15 minutes.
 */

const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const OAuth = require('oauth-1.0a');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { RateLimiter, withRetry, sleep, isRateLimit } = require('../lib/rate-limiter');
const { generateJSON } = require('../lib/claude-client');

const AGENT_NAME = 'etsy-listing';
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Etsy rate limits: 10 req/sec, 50k/day
const etsyLimiter = new RateLimiter(8, 1000); // conservative: 8 req/sec

const ETSY_BASE = 'https://openapi.etsy.com/v3';

// Etsy taxonomy IDs for product categories
const TAXONOMY_IDS = {
  't-shirt': 69150767,      // Clothing > Shirts & Tops > T-Shirts
  'hoodie': 69150984,       // Clothing > Hoodies & Sweatshirts
  'mug': 68887244,          // Kitchen & Dining > Drink & Barware > Mugs
  'tote bag': 69150595,     // Bags & Purses > Totes
  'wall art': 66774495,     // Art & Collectibles > Prints
  'phone case': 69150432,   // Electronics & Accessories > Phone Cases
};

function etsyAuthHeaders(method, url, token, tokenSecret) {
  const oauth = OAuth({
    consumer: { key: process.env.ETSY_API_KEY, secret: process.env.ETSY_API_KEY },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const requestData = { url, method };
  const tokenData = token ? { key: token, secret: tokenSecret || '' } : null;
  const oauthHeader = oauth.toHeader(oauth.authorize(requestData, tokenData));

  return {
    ...oauthHeader,
    'x-api-key': process.env.ETSY_API_KEY,
    'Content-Type': 'application/json',
  };
}

async function etsyRequest(method, path, body = null) {
  const url = `${ETSY_BASE}${path}`;
  const headers = etsyAuthHeaders(method.toUpperCase(), url, process.env.ETSY_ACCESS_TOKEN);

  await etsyLimiter.acquire();

  return withRetry(
    async () => {
      const config = { method, url, headers, timeout: 30_000 };
      if (body) config.data = body;
      const { data } = await axios(config);
      return data;
    },
    {
      maxAttempts: 4,
      baseDelayMs: 2000,
      shouldRetry: (err) => isRateLimit(err) || (err?.response?.status >= 500),
    }
  );
}

async function refreshAccessToken() {
  const { data } = await axios.post('https://api.etsy.com/v3/public/oauth/token', {
    grant_type: 'refresh_token',
    client_id: process.env.ETSY_API_KEY,
    refresh_token: process.env.ETSY_REFRESH_TOKEN,
  });
  // In a real deployment, persist the new token to env/secrets manager
  process.env.ETSY_ACCESS_TOKEN = data.access_token;
  if (data.refresh_token) process.env.ETSY_REFRESH_TOKEN = data.refresh_token;
  return data.access_token;
}

async function getShopDefaults(shopId) {
  const shop = await etsyRequest('get', `/application/shops/${shopId}`);
  const shippingProfiles = await etsyRequest('get', `/application/shops/${shopId}/shipping-profiles`);
  const returnPolicies = await etsyRequest('get', `/application/shops/${shopId}/policies/return`);

  const shippingProfileId = shippingProfiles?.results?.[0]?.shipping_profile_id;
  const returnPolicyId = returnPolicies?.results?.[0]?.return_policy_id;

  return { shippingProfileId, returnPolicyId };
}

async function generateListingContent(keyword, productType) {
  const system = 'You are an expert Etsy SEO copywriter. Return valid JSON only, no markdown fences.';
  const user = `Create an Etsy listing for a ${productType} with design theme: "${keyword}".
Return JSON with these exact keys:
{
  "title": "Compelling title under 140 chars, primary keywords first",
  "description": "5-paragraph description (about 200 words). Keywords woven naturally. Mention gift occasions, quality, fast shipping, made-to-order. End with call to action.",
  "tags": ["13", "tags", "max", "20chars", "each", "buyers", "actually", "search", "no", "spaces", "in", "single", "tag"]
}`;

  return generateJSON(system, user);
}

async function createListing(product, shopId, shippingProfileId, returnPolicyId, log) {
  log.info(`Generating SEO content for "${product.keyword}" (${product.blueprint})`);
  const content = await generateListingContent(product.keyword, product.blueprint);

  const taxonomyId = TAXONOMY_IDS[product.blueprint] || TAXONOMY_IDS['wall art'];

  const listingPayload = {
    quantity: 999,
    title: content.title.slice(0, 140),
    description: content.description,
    price: product.retail_price,
    who_made: 'i_did',
    is_supply: false,
    when_made: 'made_to_order',
    taxonomy_id: taxonomyId,
    tags: content.tags.slice(0, 13),
    shipping_profile_id: shippingProfileId,
    return_policy_id: returnPolicyId,
    is_digital: false,
    type: 'physical',
  };

  log.info(`Creating Etsy listing: "${content.title.slice(0, 60)}..."`);
  const listing = await etsyRequest('post', `/application/shops/${shopId}/listings`, listingPayload);
  const listingId = listing.listing_id;

  // Upload primary design image
  if (product.image_id) {
    try {
      // Etsy accepts image URLs for upload in some API versions; use multipart if needed
      await etsyRequest('post', `/application/shops/${shopId}/listings/${listingId}/images`, {
        listing_image_id: null,
        rank: 1,
        overwrite: true,
        is_watermarked: false,
        alt_text: content.title.slice(0, 140),
      });
    } catch (err) {
      log.warn('Could not attach listing image (non-fatal)', { error: err.message });
    }
  }

  // Activate listing
  await etsyRequest('patch', `/application/shops/${shopId}/listings/${listingId}`, {
    state: 'active',
  });

  log.info(`Listing active: ${listingId}`);

  return {
    etsy_listing_id: listingId,
    printify_product_id: product.printify_product_id,
    keyword: product.keyword,
    blueprint: product.blueprint,
    title: content.title,
    url: `https://www.etsy.com/listing/${listingId}`,
    tags: content.tags,
    views: 0,
    sales: 0,
    revenue: 0,
    retail_price: product.retail_price,
    status: 'active',
    created_at: new Date().toISOString(),
  };
}

async function runOnce(log) {
  const state = readState();

  const listedIds = new Set(state.etsy_listings.map((l) => l.printify_product_id));
  const pending = state.printify_products.filter(
    (p) => p.status === 'published' && !listedIds.has(p.printify_product_id)
  );

  if (pending.length === 0) {
    log.info('No new Printify products to list');
    return;
  }

  log.info(`Found ${pending.length} products to list on Etsy`);

  const shopId = process.env.ETSY_SHOP_ID;
  let shopDefaults;
  try {
    shopDefaults = await getShopDefaults(shopId);
  } catch (err) {
    // Try refreshing token if auth failed
    if (err?.response?.status === 401) {
      log.warn('Auth expired — refreshing token');
      await refreshAccessToken();
      shopDefaults = await getShopDefaults(shopId);
    } else {
      throw err;
    }
  }

  // Process one listing at a time
  const product = pending[0];

  try {
    const listing = await createListing(
      product, shopId, shopDefaults.shippingProfileId, shopDefaults.returnPolicyId, log
    );

    updateState((s) => {
      s.etsy_listings.push(listing);
      const idx = s.printify_products.findIndex((p) => p.printify_product_id === product.printify_product_id);
      if (idx !== -1) s.printify_products[idx].etsy_listing_id = listing.etsy_listing_id;
      return s;
    });

    log.info(`Listed: ${listing.url}`);
  } catch (err) {
    log.error(`Failed to create listing for product ${product.printify_product_id}`, { error: err.message });
    appendError(AGENT_NAME, err.message, { printify_product_id: product.printify_product_id });
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
