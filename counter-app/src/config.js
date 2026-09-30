'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Packaged app source lives inside app.asar - a single read-only archive
// file, not a real directory. Anything writable (.env, logs, the DB, the
// per-ticket temp HTML) MUST live outside it, or every write fails with
// ENOTDIR ("not a directory") the moment Node tries to mkdir/write through
// a path that passes through app.asar. Electron's per-user "userData" dir
// is the standard writable location for exactly this. Don't go back to
// path.join(__dirname, '..', ...) for anything writable.
const APP_DATA_DIR = app.getPath('userData');
const ENV_PATH = path.join(APP_DATA_DIR, '.env');

// Minimal .env loader (no dotenv dependency, per the "keep dependencies
// minimal" requirement). Values already in process.env win.
function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
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

const config = {
  relayUrl: process.env.RELAY_URL || 'http://localhost:4000',
  // The relay now runs in-process (see src/relay/server.js) — this is the
  // port IT listens on, not just where to reach an external relay-server.
  // Same default/env var as relay-server's own config.js for continuity
  // (Tailscale Funnel is configured against 4000).
  relayPort: Number(process.env.PORT) || 4000,
  // Name of the installed Windows printer, exactly as shown in Settings > Printers.
  printerName: process.env.PRINTER_NAME || '',
  printCopies: Number(process.env.PRINT_COPIES) || 1,
  dbPath: process.env.DB_PATH || path.join(APP_DATA_DIR, 'data', 'counter.db'),
  logPath: process.env.LOG_PATH || path.join(APP_DATA_DIR, 'logs', 'counter-app.log'),
  // Scratch dir for the per-ticket HTML file Electron's BrowserWindow loads
  // before printing (loadFile, not a data: URL — see KOT_TEMPLATE_SPEC.md
  // §5.2). Deliberately NOT os.tmpdir() (%TEMP%) — the same endpoint-security
  // policy that blocked Startup-folder shortcuts on the real counter PC also
  // denied mkdtemp under %TEMP% with EPERM for counter-service. This folder
  // lives next to data/ and logs/, already proven writable there.
  kotTmpDir: process.env.KOT_TMP_DIR || path.join(APP_DATA_DIR, 'tmp'),
  reconnectDelaysMs: [5000, 10000, 30000], // 5s, 10s, then 30s cap

  // Called from the tray's "Select Printer" menu. Updates the running
  // process immediately (no restart needed) and persists the choice to
  // .env so it's still selected the next time the app starts — the printer
  // is chosen once, not on every launch.
  setPrinterName(name) {
    config.printerName = name;
    const lines = fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, 'utf8').split('\n').filter((l) => l.trim())
      : [];
    let found = false;
    const next = lines.map((line) => {
      if (line.trim().toUpperCase().startsWith('PRINTER_NAME=')) {
        found = true;
        return `PRINTER_NAME=${name}`;
      }
      return line;
    });
    if (!found) next.push(`PRINTER_NAME=${name}`);
    fs.writeFileSync(ENV_PATH, next.join('\n') + '\n');
  },
};

module.exports = config;
