'use strict';

/**
 * AGENT 7 — ERROR RECOVERY & WATCHDOG
 * Monitors all other agents, catches failures, and auto-recovers.
 * Runs every 2 minutes.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { updateState, readState, appendError } = require('../lib/state-manager');
const { createLogger } = require('../lib/logger');
const { sleep } = require('../lib/rate-limiter');

const AGENT_NAME = 'error-recovery';
const LOOP_INTERVAL_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 20 * 60 * 1000; // 20 min stale = restart
const MAX_DISK_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const DESIGNS_DIR = path.resolve(__dirname, '../designs');
const ARCHIVE_DIR = path.resolve(__dirname, '../archive');
const LOGS_DIR = path.resolve(__dirname, '../logs');
const HEALTH_FILE = path.resolve(__dirname, '../state/health.json');
const STATE_LOCK = path.resolve(__dirname, '../state/business_state.json.lock');

const MANAGED_AGENTS = [
  'trend-scout',
  'design-generation',
  'printify-integration',
  'etsy-listing',
  'ad-campaign',
  'analytics-optimization',
];

// Registry of running child processes — populated by orchestrator, read-only here
// (In standalone mode, error-recovery reads heartbeat files only)
const AGENT_SCRIPT_MAP = {
  'trend-scout': path.resolve(__dirname, 'trend-scout.js'),
  'design-generation': path.resolve(__dirname, 'design-generation.js'),
  'printify-integration': path.resolve(__dirname, 'printify-integration.js'),
  'etsy-listing': path.resolve(__dirname, 'etsy-listing.js'),
  'ad-campaign': path.resolve(__dirname, 'ad-campaign.js'),
  'analytics-optimization': path.resolve(__dirname, 'analytics-optimization.js'),
};

// ── Heartbeat Monitoring ──────────────────────────────────────────────────────

function getLastHeartbeat(agentName) {
  const logFile = path.join(LOGS_DIR, `${agentName}.log`);
  if (!fs.existsSync(logFile)) return null;

  try {
    const stat = fs.statSync(logFile);
    // Use file modification time as a proxy for last write
    return stat.mtimeMs;
  } catch { return null; }
}

function isAgentStale(agentName) {
  const lastBeat = getLastHeartbeat(agentName);
  if (lastBeat === null) return true; // never started
  return Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS;
}

// ── Stale Lock Cleanup ────────────────────────────────────────────────────────

function clearStaleLock() {
  if (!fs.existsSync(STATE_LOCK)) return;
  try {
    const stat = fs.statSync(STATE_LOCK);
    if (Date.now() - stat.mtimeMs > 30_000) { // stale after 30s
      fs.unlinkSync(STATE_LOCK);
    }
  } catch { /* ignore */ }
}

// ── Disk Space ────────────────────────────────────────────────────────────────

function getDirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const file of fs.readdirSync(dir)) {
    try {
      const stat = fs.statSync(path.join(dir, file));
      if (stat.isFile()) total += stat.size;
    } catch { /* ignore */ }
  }
  return total;
}

function archiveOldDesigns(log) {
  if (!fs.existsSync(DESIGNS_DIR)) return;
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  let archived = 0;

  for (const file of fs.readdirSync(DESIGNS_DIR)) {
    const src = path.join(DESIGNS_DIR, file);
    try {
      const stat = fs.statSync(src);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        const dst = path.join(ARCHIVE_DIR, file);
        fs.renameSync(src, dst);
        archived++;
      }
    } catch { /* skip */ }
  }

  if (archived > 0) log.info(`Archived ${archived} old design files`);
}

// ── Etsy Token Refresh ────────────────────────────────────────────────────────

async function tryRefreshEtsyToken(log) {
  if (!process.env.ETSY_REFRESH_TOKEN) return;
  try {
    const axios = require('axios');
    const { data } = await axios.post('https://api.etsy.com/v3/public/oauth/token', {
      grant_type: 'refresh_token',
      client_id: process.env.ETSY_API_KEY,
      refresh_token: process.env.ETSY_REFRESH_TOKEN,
    }, { timeout: 15_000 });
    process.env.ETSY_ACCESS_TOKEN = data.access_token;
    if (data.refresh_token) process.env.ETSY_REFRESH_TOKEN = data.refresh_token;
    log.info('Etsy access token refreshed successfully');
  } catch (err) {
    log.error('Etsy token refresh failed', { error: err.message });
  }
}

// ── Health Dashboard ──────────────────────────────────────────────────────────

function writeHealthDashboard(healthData) {
  const tmp = HEALTH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(healthData, null, 2), 'utf8');
  fs.renameSync(tmp, HEALTH_FILE);
}

// ── Error Analysis ────────────────────────────────────────────────────────────

function analyzeErrors(state, log) {
  if (state.errors.length === 0) return;

  const recent = state.errors.filter(
    (e) => Date.now() - new Date(e.timestamp).getTime() < LOOP_INTERVAL_MS * 5
  );

  // Check for Printify 500s pattern
  const printifyErrors = recent.filter(
    (e) => e.agent === 'printify-integration' && e.message?.includes('5')
  );
  if (printifyErrors.length >= 3) {
    log.warn(`Printify appears unstable (${printifyErrors.length} errors) — design agent output will drain queue`);
  }

  // Check for Etsy 401s
  const etsyAuthErrors = recent.filter(
    (e) => (e.agent === 'etsy-listing' || e.agent === 'ad-campaign') &&
            (e.message?.includes('401') || e.message?.toLowerCase().includes('unauthorized'))
  );
  if (etsyAuthErrors.length >= 1) {
    log.warn('Etsy auth errors detected — triggering token refresh');
    tryRefreshEtsyToken(log).catch(() => {});
  }

  // Trim old errors from state
  updateState((s) => {
    const cutoff = Date.now() - 48 * 3600_000;
    s.errors = s.errors.filter((e) => new Date(e.timestamp).getTime() > cutoff);
    return s;
  });
}

// ── Main Watchdog Cycle ───────────────────────────────────────────────────────

function checkAndRestartAgent(agentName, log, agentRegistry) {
  if (!isAgentStale(agentName)) return;

  log.warn(`Agent ${agentName} appears stale (no heartbeat for >20min)`);

  // If the orchestrator passed us a registry of child processes, restart via it
  if (agentRegistry && agentRegistry[agentName]) {
    const proc = agentRegistry[agentName];
    if (!proc.killed && proc.exitCode === null) {
      log.info(`Agent ${agentName} process still running — forcing kill and restart`);
      proc.kill('SIGTERM');
    }
    // Orchestrator's process-exit handler will respawn it
    return;
  }

  // Standalone mode: spawn the agent directly
  const script = AGENT_SCRIPT_MAP[agentName];
  if (!script || !fs.existsSync(script)) {
    log.error(`Cannot restart ${agentName}: script not found`);
    return;
  }

  log.info(`Restarting ${agentName} as standalone process`);
  const child = execFile(process.execPath, [script], {
    env: process.env,
    detached: false,
  });
  child.on('error', (err) => log.error(`Failed to restart ${agentName}`, { error: err.message }));
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}

async function runOnce(log, agentRegistry) {
  clearStaleLock();

  const health = { updated_at: new Date().toISOString(), agents: {} };

  for (const agentName of MANAGED_AGENTS) {
    const lastBeat = getLastHeartbeat(agentName);
    const stale = lastBeat ? Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS : true;
    const errorCount = readState().errors.filter((e) => e.agent === agentName).length;

    health.agents[agentName] = {
      last_heartbeat: lastBeat ? new Date(lastBeat).toISOString() : null,
      status: stale ? 'stale' : 'healthy',
      error_count: errorCount,
    };

    if (stale) {
      checkAndRestartAgent(agentName, log, agentRegistry);
    }
  }

  writeHealthDashboard(health);

  // Disk space check
  const designsSize = getDirSizeBytes(DESIGNS_DIR);
  if (designsSize > MAX_DISK_BYTES) {
    log.warn(`Designs folder exceeds 5GB (${(designsSize / 1024 / 1024 / 1024).toFixed(1)}GB) — archiving old files`);
    archiveOldDesigns(log);
  }

  analyzeErrors(readState(), log);
}

async function run(agentRegistry = null) {
  const log = createLogger(AGENT_NAME);
  log.info('Watchdog agent started');

  const heartbeatTimer = setInterval(() => log.heartbeat(), HEARTBEAT_INTERVAL_MS);

  while (true) {
    try {
      await runOnce(log, agentRegistry);
    } catch (err) {
      log.error('Watchdog cycle failed', { error: err.message });
    }
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
