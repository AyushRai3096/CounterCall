'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');
const logger = require('./logger');
const { buildKotText, toPrintableHtml } = require('./kotTemplate');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const SUMATRA_CANDIDATES = [
  'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
  'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
  path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe'),
];

const TOOL_TIMEOUT_MS = 20000;

function findExe(configured, candidates) {
  return [configured, ...candidates].find((p) => p && fs.existsSync(p)) || null;
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: TOOL_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Maps our order onto the KOT data contract. Each item carries its own note,
// which is the ticket's "Special Note" column.
function toKot(order) {
  return {
    created_at: order.createdAt,
    kot_number: order.kotNumber,
    order_number: order.orderNumber,
    items: order.items.map((i) => ({
      item_name: i.size ? `${i.name} (${cap(i.size)})` : i.name,
      note: i.note,
      qty: i.qty,
    })),
  };
}

function ticketHtml(order) {
  const kot = toKot(order);
  return toPrintableHtml(buildKotText(kot), `KOT ${kot.kot_number}`);
}

// The exact HTML that gets printed, for the dev-mode browser preview.
function buildPreviewHtml(order) {
  return ticketHtml(order);
}

// Checks PRINTER_NAME is spelled exactly as Windows has it — a typo here
// otherwise only surfaces as a cryptic SumatraPDF failure at print time.
function printerExists(name) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Printer -Name ${JSON.stringify(name)} -ErrorAction SilentlyContinue) -ne $null`],
      { timeout: TOOL_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => resolve(!err && stdout.trim().toLowerCase() === 'true')
    );
  });
}

async function isPrinterReady() {
  const problems = [];
  if (!config.printerName) {
    problems.push('PRINTER_NAME is not set');
  } else if (!(await printerExists(config.printerName))) {
    problems.push(
      `No Windows printer named "${config.printerName}" — check Settings > Printers & ` +
      'scanners for the exact name (PRINTER_NAME in .env must match exactly)'
    );
  }
  if (!findExe(config.edgePath, EDGE_CANDIDATES)) problems.push('Microsoft Edge not found (set EDGE_PATH)');
  if (!findExe(config.sumatraPath, SUMATRA_CANDIDATES)) problems.push('SumatraPDF not found (set SUMATRA_PATH)');
  if (problems.length) logger.warn(`Printing is not ready: ${problems.join('; ')}`);
  return problems.length === 0;
}

// Fixed page height instead of measuring the ticket's actual rendered height
// first. An earlier version rendered once to measure the height via Edge's
// headless DOM dump, then rendered again at the exact size — it depended on
// Edge running a <script> and dumping the result in a specific way, which
// didn't hold on every machine ("Could not measure the ticket height").
// A fixed height has no such dependency. 297 mm matches the printer driver's
// own configured paper form (see KOT_TEMPLATE_SPEC.md) and comfortably fits
// a normal order; estimateHeightMm only raises it for an unusually large one
// — plain arithmetic on the order data, nothing that depends on how Edge
// renders anything.
const FIXED_HEIGHT_MM = 297;

function estimateHeightMm(order) {
  const HEADER_MM = 30; // date/time, KOT no., Delivery, Order No, dotted rule, column header row
  const TAIL_MM = 55; // the template's own bottom padding — always reserved
  const NAME_COL_CHARS_PER_LINE = 16; // k-item is ~58% of 58mm content width, bold 12px
  const NOTE_COL_CHARS_PER_LINE = 10; // k-note is ~22% of 58mm content width
  const MM_PER_LINE = 4.5;

  const itemsMm = order.items.reduce((sum, item) => {
    const nameLines = Math.ceil((item.name || '').length / NAME_COL_CHARS_PER_LINE) || 1;
    const noteLines = Math.ceil((item.note || '').length / NOTE_COL_CHARS_PER_LINE) || 1;
    return sum + Math.max(nameLines, noteLines) * MM_PER_LINE;
  }, 0);

  return Math.ceil(HEADER_MM + itemsMm + TAIL_MM);
}

async function renderPdf(order, html, dir) {
  const edge = findExe(config.edgePath, EDGE_CANDIDATES);
  if (!edge) throw new Error('Microsoft Edge not found (set EDGE_PATH)');

  const heightMm = Math.max(FIXED_HEIGHT_MM, estimateHeightMm(order));
  const ticketFile = path.join(dir, 'ticket.html');
  const pdfFile = path.join(dir, 'ticket.pdf');
  fs.writeFileSync(ticketFile, html.replace('</head>', `<style>@page { size: 80mm ${heightMm}mm; margin: 0; }</style></head>`));

  await run(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`,
    `file:///${ticketFile.replace(/\\/g, '/')}`,
  ]);
  if (!fs.existsSync(pdfFile)) throw new Error('Edge did not produce a PDF');
  return pdfFile;
}

/**
 * Renders and prints the ticket. Throws on any failure — callers must not
 * mark the order 'printed' unless this resolves without throwing.
 */
async function printOrder(order) {
  if (!config.printerName) throw new Error('PRINTER_NAME is not set');
  // Checked every time, not just at startup: SumatraPDF may not report an
  // error for a printer name that doesn't exist, which would otherwise mark
  // an order 'printed' when nothing came out.
  if (!(await printerExists(config.printerName))) {
    throw new Error(`No Windows printer named "${config.printerName}" (check PRINTER_NAME in .env)`);
  }
  const sumatra = findExe(config.sumatraPath, SUMATRA_CANDIDATES);
  if (!sumatra) throw new Error('SumatraPDF not found (set SUMATRA_PATH)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'countercall-kot-'));
  try {
    const pdf = await renderPdf(order, ticketHtml(order), dir);
    // Copies are separate sequential print jobs, not a driver "copies" option.
    for (let i = 0; i < config.printCopies; i += 1) {
      await run(sumatra, ['-print-to', config.printerName, '-silent', '-print-settings', 'noscale', pdf]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { printOrder, isPrinterReady, buildPreviewHtml };
