'use strict';

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '../logs');

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function createLogger(agentName) {
  const logFile = path.join(LOGS_DIR, `${agentName}.log`);

  function write(level, msg, meta) {
    const line = `[${timestamp()}] [${level}] ${msg}` +
                 (meta ? ` ${JSON.stringify(meta)}` : '') + '\n';
    // console output with agent prefix
    process.stdout.write(`[${agentName}] ${line}`);
    try {
      fs.appendFileSync(logFile, line);
    } catch { /* disk full / permissions — don't crash the agent */ }
  }

  function heartbeat() {
    const line = `[${timestamp()}] [HEARTBEAT] alive\n`;
    try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  }

  return {
    info: (msg, meta) => write('INFO ', msg, meta),
    warn: (msg, meta) => write('WARN ', msg, meta),
    error: (msg, meta) => write('ERROR', msg, meta),
    heartbeat,
    logFile,
    agentName,
  };
}

module.exports = { createLogger };
