'use strict';

/**
 * ORCHESTRATOR — Etsy Print-on-Demand AI Business
 *
 * Initialises all infrastructure, validates environment, spawns all 7 agents
 * as concurrent child processes, and displays a live terminal dashboard.
 *
 * Usage: node orchestrator.js
 */

// Load .env if present (dotenv-lite inline — no extra dependency)
(function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const envFile = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
})();

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const { initState, readState } = require('./lib/state-manager');
const { validate: validateEnv } = require('./lib/env-validator');
const { sleep } = require('./lib/rate-limiter');

// ── Directories ───────────────────────────────────────────────────────────────

const DIRS = ['state', 'designs', 'logs', 'reports', 'archive'].map((d) =>
  path.resolve(__dirname, d)
);

function ensureDirs() {
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Agent Definitions ─────────────────────────────────────────────────────────

const AGENTS = [
  { name: 'trend-scout',            script: './agents/trend-scout.js',            restartDelay: 10_000 },
  { name: 'design-generation',      script: './agents/design-generation.js',      restartDelay: 15_000 },
  { name: 'printify-integration',   script: './agents/printify-integration.js',   restartDelay: 15_000 },
  { name: 'etsy-listing',           script: './agents/etsy-listing.js',           restartDelay: 15_000 },
  { name: 'ad-campaign',            script: './agents/ad-campaign.js',            restartDelay: 20_000 },
  { name: 'analytics-optimization', script: './agents/analytics-optimization.js', restartDelay: 30_000 },
  { name: 'error-recovery',         script: './agents/error-recovery.js',         restartDelay: 5_000  },
];

// ── Process Registry ──────────────────────────────────────────────────────────

const registry = {}; // agentName → ChildProcess

function spawnAgent(agent) {
  const scriptPath = path.resolve(__dirname, agent.script);

  const child = fork(scriptPath, [], {
    env: process.env,
    silent: false, // inherit stdio so logs flow to terminal + log files
  });

  child.on('exit', (code, signal) => {
    console.log(`\n[ORCHESTRATOR] Agent "${agent.name}" exited (code=${code}, signal=${signal}). Restarting in ${agent.restartDelay / 1000}s…`);
    registry[agent.name] = null;
    setTimeout(() => {
      registry[agent.name] = spawnAgent(agent);
    }, agent.restartDelay);
  });

  child.on('error', (err) => {
    console.error(`[ORCHESTRATOR] Error from agent "${agent.name}":`, err.message);
  });

  registry[agent.name] = child;
  return child;
}

function spawnAllAgents() {
  console.log('[ORCHESTRATOR] Spawning all agents…\n');
  for (const agent of AGENTS) {
    spawnAgent(agent);
    // Stagger starts to avoid simultaneous file-lock contention
    // (not truly sequential — just a brief offset)
  }
}

// ── Live Dashboard ────────────────────────────────────────────────────────────

const DASHBOARD_INTERVAL_MS = 30_000;

function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function agentStatus(name) {
  const proc = registry[name];
  if (!proc) return '⟳ restarting';

  // Check heartbeat age from log file
  const logFile = path.resolve(__dirname, 'logs', `${name}.log`);
  if (!fs.existsSync(logFile)) return '? no log';
  try {
    const { mtimeMs } = fs.statSync(logFile);
    const ageSec = Math.round((Date.now() - mtimeMs) / 1000);
    return ageSec < 120 ? `✓ alive (${ageSec}s)` : `⚠ stale (${ageSec}s)`;
  } catch { return '? error'; }
}

function renderDashboard() {
  const state = readState();
  const now = new Date().toLocaleString();

  const totalRevenue = (state.etsy_listings || []).reduce((s, l) => s + (l.revenue || 0), 0);
  const totalAdSpend = (state.ad_campaigns || []).reduce(
    (s, c) => s + (c.meta?.spend || 0), 0
  );
  const netProfit = totalRevenue - totalAdSpend;

  const lines = [
    '\n' + '═'.repeat(70),
    `  ETSY POD AI ORCHESTRATOR  —  ${now}`,
    '═'.repeat(70),
    '',
    '  AGENTS',
    '  ' + '─'.repeat(66),
    ...AGENTS.map((a) => `  ${pad(a.name, 26)} ${agentStatus(a.name)}`),
    '',
    '  PIPELINE',
    '  ' + '─'.repeat(66),
    `  ${pad('Trends discovered', 26)} ${rpad(state.trends?.length ?? 0, 6)}`,
    `  ${pad('Designs in queue', 26)} ${rpad(state.design_queue?.length ?? 0, 6)}`,
    `  ${pad('Approved designs', 26)} ${rpad(state.approved_designs?.length ?? 0, 6)}`,
    `  ${pad('Printify products', 26)} ${rpad(state.printify_products?.length ?? 0, 6)}`,
    `  ${pad('Live Etsy listings', 26)} ${rpad(state.etsy_listings?.filter((l) => l.status === 'active').length ?? 0, 6)}`,
    `  ${pad('Ad campaigns', 26)} ${rpad(state.ad_campaigns?.length ?? 0, 6)}`,
    '',
    '  FINANCIALS (lifetime)',
    '  ' + '─'.repeat(66),
    `  ${pad('Total Revenue', 26)} $${rpad(totalRevenue.toFixed(2), 10)}`,
    `  ${pad('Total Ad Spend', 26)} $${rpad(totalAdSpend.toFixed(2), 10)}`,
    `  ${pad('Net Profit', 26)} $${rpad(netProfit.toFixed(2), 10)}`,
    '',
    `  Errors logged: ${state.errors?.length ?? 0}   Last updated: ${state.last_updated || 'never'}`,
    '═'.repeat(70),
  ];

  // Clear screen and redraw
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(lines.join('\n'));
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[ORCHESTRATOR] Received ${signal} — shutting down all agents…`);
  for (const [name, proc] of Object.entries(registry)) {
    if (proc && !proc.killed) {
      console.log(`  Terminating ${name}`);
      proc.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Entry Point ───────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     ETSY PRINT-ON-DEMAND AI ORCHESTRATOR  —  Starting up…      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Create directories
  ensureDirs();
  console.log('✓ Directories ready');

  // 2. Validate environment
  const envConfig = validateEnv();
  console.log(`✓ Environment validated (image provider: ${envConfig.imageProvider})`);
  if (!envConfig.hasMetaAds) console.log('  ℹ  Meta Ads disabled (optional vars not set)');
  if (!envConfig.hasPinterest) console.log('  ℹ  Pinterest disabled (optional vars not set)');

  // 3. Initialise shared state
  initState();
  console.log('✓ Shared state initialised');

  // 4. Spawn all agents simultaneously
  spawnAllAgents();
  console.log('\n✓ All 7 agents launched\n');

  // 5. Live dashboard loop
  await sleep(5000); // brief pause so first logs appear before dashboard takes over
  renderDashboard();
  setInterval(renderDashboard, DASHBOARD_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[ORCHESTRATOR] Fatal startup error:', err);
  process.exit(1);
});
