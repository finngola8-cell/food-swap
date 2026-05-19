'use strict';

/**
 * AGENT 2 — DESIGN GENERATION
 * Turns trending topics into product-ready designs via AI image generation.
 * Polls state.trends every 5 minutes.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { withRetry, sleep } = require('../lib/rate-limiter');

const AGENT_NAME = 'design-generation';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const DESIGNS_DIR = path.resolve(__dirname, '../designs');
const AUTO_APPROVE_THRESHOLD = 7.5;
const MAX_FILESIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const VARIANTS = [
  { name: 'minimalist', style: 'minimalist clean, simple lines, white background, high contrast, modern' },
  { name: 'vintage', style: 'vintage retro, distressed texture, warm muted tones, classic feel' },
  { name: 'bold', style: 'bold graphic, vibrant colors, strong composition, eye-catching, flat design' },
];

function buildPrompt(trend, variantStyle) {
  return `Print-on-demand product design for: "${trend.keyword}"
Style: ${trend.style_notes}, ${variantStyle}
Requirements:
- Transparent or white background suitable for POD printing
- High contrast design that reads well at small sizes
- 4500x5400 pixels, 300dpi, portrait orientation
- NO copyrighted characters, logos, or existing IP
- Typography must be clearly legible if included
- Color palette: max 5 colors appropriate for aesthetic
- Centered composition with safe margins on all sides
Output: high quality PNG suitable for print production`;
}

async function generateWithFal(prompt) {
  const fal = require('@fal-ai/serverless-client');
  fal.config({ credentials: process.env.FAL_API_KEY });

  const result = await withRetry(
    () => fal.run('fal-ai/flux/schnell', {
      input: {
        prompt,
        image_size: { width: 1024, height: 1024 }, // FAL scales; we'll upscale with sharp
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true,
        output_format: 'png',
      },
    }),
    { maxAttempts: 3, baseDelayMs: 5000 }
  );

  const imageUrl = result?.images?.[0]?.url;
  if (!imageUrl) throw new Error('FAL returned no image URL');
  return imageUrl;
}

async function generateWithReplicate(prompt) {
  const Replicate = require('replicate');
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const output = await withRetry(
    () => replicate.run('black-forest-labs/flux-schnell', {
      input: {
        prompt,
        aspect_ratio: '3:4',
        output_format: 'png',
        output_quality: 95,
        num_inference_steps: 4,
      },
    }),
    { maxAttempts: 3, baseDelayMs: 5000 }
  );

  // Replicate returns an array of URLs or ReadableStreams
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    return typeof item === 'string' ? item : null;
  }
  throw new Error('Replicate returned unexpected output format');
}

async function generateImage(prompt) {
  if (process.env.FAL_API_KEY) {
    return generateWithFal(prompt);
  }
  if (process.env.REPLICATE_API_TOKEN) {
    return generateWithReplicate(prompt);
  }
  throw new Error('No image generation API key configured (FAL_API_KEY or REPLICATE_API_TOKEN)');
}

async function downloadAndSave(imageUrl, filePath) {
  const response = await withRetry(
    () => axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60_000 }),
    { maxAttempts: 3, baseDelayMs: 2000 }
  );
  const buffer = Buffer.from(response.data);

  // Resize to 4500x5400 using sharp (maintain quality)
  await sharp(buffer)
    .resize(4500, 5400, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png({ quality: 100, compressionLevel: 6 })
    .toFile(filePath);
}

async function qualityCheck(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILESIZE_BYTES) return { pass: false, reason: 'File exceeds 20MB limit', score: 0 };
  if (stat.size < 50_000) return { pass: false, reason: 'File suspiciously small — likely failed generation', score: 0 };

  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) return { pass: false, reason: 'Cannot read image dimensions', score: 0 };

  let score = 7.0;

  // Dimension check
  if (meta.width >= 4000 && meta.height >= 4800) score += 1.0;
  else if (meta.width < 1000 || meta.height < 1000) score -= 2.0;

  // File size health (too small or too large is bad)
  const sizeMB = stat.size / 1024 / 1024;
  if (sizeMB > 1 && sizeMB < 18) score += 0.5;

  // Sharpness proxy: measure entropy via stats
  try {
    const stats = await sharp(filePath).stats();
    const avgStdDev = stats.channels.reduce((s, c) => s + c.stdev, 0) / stats.channels.length;
    if (avgStdDev > 50) score += 0.5; // high variance = more detail / not blurry
    if (avgStdDev < 10) score -= 1.0; // very low variance = likely blank/near-blank
  } catch { /* optional check */ }

  const finalScore = Math.min(Math.round(score * 10) / 10, 10);
  return { pass: finalScore >= 5, score: finalScore, dimensions: `${meta.width}x${meta.height}`, sizeMB: sizeMB.toFixed(1) };
}

function trendAlreadyInQueue(trendKeyword, state) {
  return (
    state.design_queue.some((d) => d.keyword === trendKeyword) ||
    state.approved_designs.some((d) => d.keyword === trendKeyword)
  );
}

async function processOneTrend(trend, log) {
  log.info(`Processing trend: "${trend.keyword}"`);
  const results = [];

  for (const variant of VARIANTS) {
    const id = uuidv4();
    const safeName = trend.keyword.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const fileName = `${safeName}_${variant.name}_${Date.now()}.png`;
    const filePath = path.join(DESIGNS_DIR, fileName);

    try {
      const prompt = buildPrompt(trend, variant.style);
      log.info(`Generating ${variant.name} variant for "${trend.keyword}"`);

      const imageUrl = await generateImage(prompt);
      await downloadAndSave(imageUrl, filePath);

      const qc = await qualityCheck(filePath);
      log.info(`Quality check: score=${qc.score}, pass=${qc.pass}`, qc);

      const designEntry = {
        id,
        trend_id: trend.keyword,
        keyword: trend.keyword,
        variant: variant.name,
        file_path: filePath,
        product_types: trend.product_types,
        status: qc.score >= AUTO_APPROVE_THRESHOLD ? 'approved' : 'pending_review',
        quality_score: qc.score,
        generated_at: new Date().toISOString(),
      };

      results.push(designEntry);
    } catch (err) {
      log.error(`Failed to generate ${variant.name} variant for "${trend.keyword}"`, { error: err.message });
      // Clean up partial file
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
    }

    await sleep(3000); // pace requests
  }

  return results;
}

async function runOnce(log) {
  const state = readState();
  const newTrends = state.trends.filter((t) => !trendAlreadyInQueue(t.keyword, state));

  if (newTrends.length === 0) {
    log.info('No new trends to process');
    return;
  }

  log.info(`Found ${newTrends.length} new trends to design`);

  // Process up to 3 trends per cycle to avoid spending too much at once
  const batch = newTrends.slice(0, 3);

  for (const trend of batch) {
    try {
      const designs = await processOneTrend(trend, log);

      updateState((s) => {
        for (const design of designs) {
          if (design.status === 'approved') {
            s.approved_designs.push(design);
          } else {
            s.design_queue.push(design);
          }
        }
        return s;
      });

      log.info(`Completed trend "${trend.keyword}": ${designs.length} designs generated`);
    } catch (err) {
      log.error(`Failed to process trend "${trend.keyword}"`, { error: err.message });
      appendError(AGENT_NAME, err.message, { trend: trend.keyword });
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
