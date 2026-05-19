'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Generate text from Claude.  Returns raw string.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} opts
 * @param {number} opts.maxTokens
 * @param {boolean} opts.cache  Enable prompt caching on the system prompt.
 */
async function generateText(systemPrompt, userPrompt, {
  maxTokens = 1024,
  cache = true,
} = {}) {
  const client = getClient();
  const systemContent = cache
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    system: systemContent,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return message.content[0].text;
}

/**
 * Generate and parse JSON from Claude.  Throws if response is not valid JSON.
 */
async function generateJSON(systemPrompt, userPrompt, opts = {}) {
  const raw = await generateText(systemPrompt, userPrompt, { ...opts, maxTokens: opts.maxTokens || 2048 });
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { generateText, generateJSON };
