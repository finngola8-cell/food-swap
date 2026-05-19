'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.resolve(__dirname, '../state/business_state.json');
const TMP_FILE = STATE_FILE + '.tmp';
const LOCK_FILE = STATE_FILE + '.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 50;

const INITIAL_STATE = {
  trends: [],
  design_queue: [],
  approved_designs: [],
  printify_products: [],
  etsy_listings: [],
  ad_campaigns: [],
  analytics: {},
  errors: [],
  last_updated: '',
};

function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // O_EXCL makes this atomic — fails if lock file already exists
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Another process holds the lock — check if it's stale
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {
        // lock file disappeared between check and stat — retry
      }
      // Busy-wait with a short sleep approximation (sync context)
      const end = Date.now() + LOCK_RETRY_INTERVAL_MS;
      while (Date.now() < end) { /* spin */ }
    }
  }
  throw new Error('Could not acquire state lock within timeout');
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { ...INITIAL_STATE };
  }
}

function writeState(state) {
  state.last_updated = new Date().toISOString();
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(TMP_FILE, json, 'utf8');
  fs.renameSync(TMP_FILE, STATE_FILE); // atomic on POSIX
}

/**
 * Read-modify-write with file locking.
 * @param {(state: object) => object} updater  Pure function: receives current state, returns updated state.
 */
function updateState(updater) {
  acquireLock();
  try {
    const current = readState();
    const next = updater(current);
    writeState(next);
    return next;
  } finally {
    releaseLock();
  }
}

function initState() {
  if (!fs.existsSync(STATE_FILE)) {
    writeState({ ...INITIAL_STATE });
  }
}

function appendError(agentName, message, details = {}) {
  updateState((state) => {
    state.errors = [
      { agent: agentName, message, details, timestamp: new Date().toISOString() },
      ...state.errors,
    ].slice(0, 500); // keep last 500 errors
    return state;
  });
}

module.exports = { readState, writeState, updateState, initState, appendError };
