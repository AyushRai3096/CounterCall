'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.logPath), { recursive: true });

function write(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(config.logPath, line + '\n');
}

module.exports = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  // Dedicated helper for order state transitions, so they're easy to grep.
  transition: (orderId, from, to) => write('TRANSITION', `order=${orderId} ${from} -> ${to}`),
};
