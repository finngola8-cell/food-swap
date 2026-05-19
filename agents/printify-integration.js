'use strict';

/**
 * AGENT 3 — PRINTIFY INTEGRATION
 * Takes approved designs and creates real Printify products automatically.
 * Polls state.approved_designs every 10 minutes.
 */

const fs = require('fs');
const axios = require('axios');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { RateLimiter, withRetry, sleep, isRateLimit, isServerError } = require('../lib/rate-limiter');
const { generateJSON } = require('../lib/claude-client');

const AGENT_NAME = 'printify-integration';
const POLL_INTERVAL_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Printify rate limit: 60 req/min
const printifyLimiter = new RateLimiter(55, 60_000);

const BASE_URL = 'https://api.printify.com/v1';

// Blueprint IDs for product types
const BLUEPRINTS = {
  't-shirt': { id: 5, label: 'Unisex Jersey Short Sleeve Tee' },
  'mug': { id: 166, label: 'White Glossy Mug 11oz' },
  'tote bag': { id: 523, label: 'Tote Bag' },
  'wall art': { id: 456, label: 'Enhanced Matte Paper Poster' },
  'hoodie': { id: 77, label: 'Unisex Heavy Blend Hooded Sweatshirt' },
  'phone case': { id: 394, label: 'Tough Phone Case' },
};

const PRICE_MULTIPLIER = 2.8;

function printifyApi() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

async function printifyRequest(method, url, data) {
  const api = printifyApi();
  await printifyLimiter.acquire();
  return withRetry(
    () => api[method](url, data).then((r) => r.data),
    {
      maxAttempts: 5,
      baseDelayMs: 2000,
      maxDelayMs: 32_000,
      shouldRetry: (err) => isRateLimit(err) || isServerError(err),
    }
  );
}

async function uploadImage(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  const fileName = filePath.split('/').pop();

  const result = await printifyRequest('post', '/uploads/images.json', {
    file_name: fileName,
    contents: base64,
  });

  return result.id;
}

async function getBestPrintProvider(blueprintId) {
  const providers = await printifyRequest('get', `/catalog/blueprints/${blueprintId}/print_providers.json`);
  if (!providers || providers.length === 0) throw new Error(`No print providers for blueprint ${blueprintId}`);

  // Prefer US-based providers with highest rating
  const usProviders = providers.filter((p) => p.location?.country === 'US' || p.title?.includes('US'));
  const sorted = (usProviders.length > 0 ? usProviders : providers)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return sorted[0];
}

async function getVariants(blueprintId, providerId) {
  const variants = await printifyRequest(
    'get',
    `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`
  );
  return variants?.variants || variants || [];
}

async function generateProductContent(keyword, productType) {
  const system = 'You are an expert Etsy SEO specialist for print-on-demand products. Return valid JSON only, no markdown.';
  const user = `Create Etsy product content for a ${productType} with design theme: "${keyword}".
Return JSON: {
  "title": "SEO title under 140 chars, keywords first",
  "description": "150-word description with natural keyword integration, mention gift-giving occasions, quality, uniqueness",
  "tags": ["array", "of", "13", "etsy", "tags", "max", "20", "chars", "each"]
}`;

  return generateJSON(system, user);
}

async function createPrintifyProduct(design, productType, log) {
  const blueprint = BLUEPRINTS[productType];
  if (!blueprint) {
    log.warn(`No blueprint configured for product type: ${productType}`);
    return null;
  }

  log.info(`Creating ${productType} for "${design.keyword}" (blueprint ${blueprint.id})`);

  // Step A: Upload image
  const imageId = await uploadImage(design.file_path);
  log.info(`Image uploaded: ${imageId}`);

  // Step B: Get print provider
  const provider = await getBestPrintProvider(blueprint.id);
  log.info(`Selected provider: ${provider.title} (id: ${provider.id})`);

  // Step C: Get variants
  const variantList = await getVariants(blueprint.id, provider.id);
  if (variantList.length === 0) throw new Error(`No variants available for blueprint ${blueprint.id}`);

  // Calculate price from base cost
  const avgBaseCost = variantList.reduce((s, v) => s + (v.cost || 0), 0) / variantList.length;
  const retailPrice = Math.ceil(avgBaseCost * PRICE_MULTIPLIER * 100); // in cents

  // Get print areas for this provider
  const printAreaData = await printifyRequest(
    'get',
    `/catalog/blueprints/${blueprint.id}/print_providers/${provider.id}/shipping.json`
  );

  // Step D: Generate SEO content
  const content = await generateProductContent(design.keyword, productType);

  // Build variants payload
  const variants = variantList.map((v) => ({
    id: v.id,
    price: retailPrice,
    is_enabled: true,
  }));

  // Build print areas — use front print area by default
  const printAreas = [{
    variant_ids: variantList.map((v) => v.id),
    placeholders: [{
      position: 'front',
      images: [{
        id: imageId,
        x: 0.5,
        y: 0.5,
        scale: 1,
        angle: 0,
      }],
    }],
  }];

  // Step E: Create product
  const shopId = process.env.PRINTIFY_SHOP_ID;
  const product = await printifyRequest('post', `/shops/${shopId}/products.json`, {
    title: content.title,
    description: content.description,
    blueprint_id: blueprint.id,
    print_provider_id: provider.id,
    variants,
    print_areas: printAreas,
    tags: content.tags,
  });

  log.info(`Product created: ${product.id}`);

  // Step F: Publish product
  await printifyRequest('post', `/shops/${shopId}/products/${product.id}/publishing_succeeded.json`, {
    title: true,
    description: true,
    images: true,
    variants: true,
    tags: true,
    keyFeatures: true,
    shipping_template: true,
  });

  log.info(`Product published: ${product.id}`);

  return {
    printify_product_id: product.id,
    design_id: design.id,
    keyword: design.keyword,
    blueprint: productType,
    title: content.title,
    tags: content.tags,
    variants_count: variants.length,
    base_cost: avgBaseCost / 100,
    retail_price: retailPrice / 100,
    image_id: imageId,
    provider_id: provider.id,
    status: 'published',
    created_at: new Date().toISOString(),
  };
}

async function processDesign(design, log) {
  const products = [];

  for (const productType of design.product_types) {
    try {
      const product = await createPrintifyProduct(design, productType, log);
      if (product) products.push(product);
      await sleep(5000); // pace between product creations
    } catch (err) {
      log.error(`Failed to create ${productType} for "${design.keyword}"`, { error: err.message });
      appendError(AGENT_NAME, err.message, { design_id: design.id, productType });
    }
  }

  return products;
}

async function runOnce(log) {
  const state = readState();

  const publishedIds = new Set(state.printify_products.map((p) => p.design_id));
  const pending = state.approved_designs.filter(
    (d) => d.status === 'approved' && !publishedIds.has(d.id)
  );

  if (pending.length === 0) {
    log.info('No new approved designs to publish');
    return;
  }

  log.info(`Processing ${pending.length} approved designs`);

  // Process one design at a time to stay within rate limits
  const design = pending[0];

  try {
    log.info(`Processing design: ${design.id} ("${design.keyword}")`);
    const products = await processDesign(design, log);

    if (products.length > 0) {
      updateState((s) => {
        s.printify_products.push(...products);
        // Mark design as processed
        const idx = s.approved_designs.findIndex((d) => d.id === design.id);
        if (idx !== -1) s.approved_designs[idx].status = 'published';
        return s;
      });
      log.info(`Created ${products.length} products for "${design.keyword}"`);
    }
  } catch (err) {
    log.error(`Failed to process design ${design.id}`, { error: err.message });
    appendError(AGENT_NAME, err.message, { design_id: design.id });
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
