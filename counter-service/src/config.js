'use strict';

const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dotenv dependency, per the "keep dependencies
// minimal" requirement). Values already in process.env win.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

module.exports = {
  relayUrl: process.env.RELAY_URL || 'http://localhost:4000',
  printerType: process.env.PRINTER_TYPE || 'epson',
  printerInterface: process.env.PRINTER_INTERFACE || 'tcp://192.168.1.50:9100',
  restaurantName: process.env.RESTAURANT_NAME || 'CounterCall',
  dbPath: path.join(__dirname, '..', 'data', 'counter.db'),
  logPath: path.join(__dirname, '..', 'logs', 'counter-service.log'),
  reconnectDelaysMs: [5000, 10000, 30000], // 5s, 10s, then 30s cap
  // Dev mode replaces the real ESC/POS printer with a browser preview
  // (Accept/Reject buttons) so both the success and failure paths can be
  // exercised without physical hardware. Defaults to OFF (real printer)
  // unless explicitly enabled — the failure mode of defaulting to "on"
  // is much worse: a production install that forgets to set this would
  // silently never print anything, with nobody watching a preview page
  // to notice.
  devMode: process.env.DEV_MODE === 'true',
  devPreviewPort: Number(process.env.DEV_PREVIEW_PORT) || 4100,
};
