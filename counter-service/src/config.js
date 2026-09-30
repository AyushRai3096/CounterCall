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
  // Name of the installed Windows printer, exactly as shown in Settings > Printers.
  printerName: process.env.PRINTER_NAME || '',
  // Tickets are HTML rendered to PDF by Edge (headless), then printed by SumatraPDF.
  // Leave blank to auto-detect the usual install locations.
  edgePath: process.env.EDGE_PATH || '',
  sumatraPath: process.env.SUMATRA_PATH || '',
  printCopies: Number(process.env.PRINT_COPIES) || 1,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'counter.db'),
  logPath: process.env.LOG_PATH || path.join(__dirname, '..', 'logs', 'counter-service.log'),
  // Scratch dir for the HTML/PDF Edge renders per ticket. Deliberately NOT
  // os.tmpdir() (%TEMP%) — on the real counter PC, endpoint-security policy
  // (the same kind that blocks Startup-folder/desktop shortcuts) denied
  // mkdtemp there with EPERM. This folder lives next to data/ and logs/,
  // which are already proven writable on that machine.
  kotTmpDir: process.env.KOT_TMP_DIR || path.join(__dirname, '..', 'tmp'),
  reconnectDelaysMs: [5000, 10000, 30000], // 5s, 10s, then 30s cap
  // Dev mode replaces the real printer with a browser preview
  // (Accept/Reject buttons) so both the success and failure paths can be
  // exercised without physical hardware. Defaults to OFF (real printer)
  // unless explicitly enabled — the failure mode of defaulting to "on"
  // is much worse: a production install that forgets to set this would
  // silently never print anything, with nobody watching a preview page
  // to notice.
  devMode: process.env.DEV_MODE === 'true',
  devPreviewPort: Number(process.env.DEV_PREVIEW_PORT) || 4100,
};
