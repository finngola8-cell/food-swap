'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { readState } = require('../lib/state-manager');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const HEALTH_FILE = path.resolve(__dirname, '../state/health.json');
const LOGS_DIR = path.resolve(__dirname, '../logs');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function readHealth() {
  try { return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); } catch { return { agents: {} }; }
}

function readRecentLog(agentName, lines = 5) {
  const file = path.join(LOGS_DIR, `${agentName}.log`);
  if (!fs.existsSync(file)) return [];
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.trim().split('\n').slice(-lines);
  } catch { return []; }
}

function buildPayload() {
  const state = readState();
  const health = readHealth();

  const agents = [
    'trend-scout', 'design-generation', 'printify-integration',
    'etsy-listing', 'ad-campaign', 'analytics-optimization', 'error-recovery',
  ].map((name) => {
    const h = health.agents?.[name] || {};
    const logFile = path.join(LOGS_DIR, `${name}.log`);
    const lastBeat = fs.existsSync(logFile)
      ? Date.now() - fs.statSync(logFile).mtimeMs
      : Infinity;

    return {
      name,
      status: lastBeat < 120_000 ? 'online' : lastBeat < 600_000 ? 'idle' : 'offline',
      lastHeartbeat: h.last_heartbeat || null,
      errorCount: (state.errors || []).filter((e) => e.agent === name).length,
      recentLog: readRecentLog(name, 3),
    };
  });

  const totalRevenue = (state.etsy_listings || []).reduce((s, l) => s + (l.revenue || 0), 0);
  const totalAdSpend = (state.ad_campaigns || []).reduce((s, c) => s + (c.meta?.spend || 0), 0);

  return {
    agents,
    pipeline: {
      trends: (state.trends || []).length,
      design_queue: (state.design_queue || []).length,
      approved_designs: (state.approved_designs || []).length,
      printify_products: (state.printify_products || []).length,
      etsy_listings: (state.etsy_listings || []).filter((l) => l.status === 'active').length,
      ad_campaigns: (state.ad_campaigns || []).length,
    },
    financials: {
      revenue: totalRevenue,
      adSpend: totalAdSpend,
      netProfit: totalRevenue - totalAdSpend,
      orders: (state.etsy_listings || []).reduce((s, l) => s + (l.sales || 0), 0),
    },
    errors: (state.errors || []).slice(0, 10),
    lastUpdated: state.last_updated || null,
  };
}

const sseClients = new Set();

function startDashboard(port = 3001) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // SSE stream for live updates
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 2000\n\n');

      const send = () => {
        try {
          res.write(`data: ${JSON.stringify(buildPayload())}\n\n`);
        } catch { sseClients.delete(send); }
      };

      sseClients.add(send);
      send(); // immediate first update

      req.on('close', () => sseClients.delete(send));
      return;
    }

    // Static files
    let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    filePath = path.resolve(filePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); res.end(); return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  });

  // Push updates to all SSE clients every 2 seconds
  setInterval(() => {
    for (const send of sseClients) send();
  }, 2000);

  server.listen(port, () => {
    console.log(`[DASHBOARD] ✦ Isometric city running → http://localhost:${port}`);
  });

  return server;
}

module.exports = { startDashboard };
