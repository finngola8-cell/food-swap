'use strict';

/**
 * Token-bucket rate limiter + exponential backoff helper.
 */
class RateLimiter {
  /**
   * @param {number} maxRequests  Requests allowed per window
   * @param {number} windowMs     Window duration in milliseconds
   */
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.windowMs) {
      this.tokens = this.maxRequests;
      this.lastRefill = now;
    }
  }

  async acquire() {
    this._refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // Wait until next window
    const wait = this.windowMs - (Date.now() - this.lastRefill);
    await sleep(wait > 0 ? wait : this.windowMs);
    this._refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  async run(fn) {
    await this.acquire();
    return fn();
  }
}

/**
 * Retry with exponential backoff.
 * @param {() => Promise<any>} fn
 * @param {object} opts
 * @param {number} opts.maxAttempts
 * @param {number} opts.baseDelayMs
 * @param {number} opts.maxDelayMs
 * @param {(err: Error) => boolean} opts.shouldRetry  Return false to stop immediately.
 */
async function withRetry(fn, {
  maxAttempts = 5,
  baseDelayMs = 1000,
  maxDelayMs = 30_000,
  shouldRetry = () => true,
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === maxAttempts - 1) throw err;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.random() * 0.3 * delay;
      await sleep(delay + jitter);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err) {
  return err?.response?.status === 429;
}

function isServerError(err) {
  const status = err?.response?.status;
  return status >= 500 && status < 600;
}

module.exports = { RateLimiter, withRetry, sleep, isRateLimit, isServerError };
