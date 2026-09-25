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

async function isPrinterReady() {
  const problems = [];
  if (!config.printerName) problems.push('PRINTER_NAME is not set');
  if (!findExe(config.edgePath, EDGE_CANDIDATES)) problems.push('Microsoft Edge not found (set EDGE_PATH)');
  if (!findExe(config.sumatraPath, SUMATRA_CANDIDATES)) problems.push('SumatraPDF not found (set SUMATRA_PATH)');
  if (problems.length) logger.warn(`Printing is not ready: ${problems.join('; ')}`);
  return problems.length === 0;
}

// Renders the ticket to a PDF whose page is exactly as tall as the ticket, so the
// roll feeds the ticket plus the template's own 55 mm tail and nothing more.
async function renderPdf(html, dir) {
  const edge = findExe(config.edgePath, EDGE_CANDIDATES);
  if (!edge) throw new Error('Microsoft Edge not found (set EDGE_PATH)');

  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--user-data-dir=${path.join(dir, 'profile')}`,
  ];

  // Pass 1: lay the ticket out and read back its height.
  const measureFile = path.join(dir, 'measure.html');
  const probe = '<script>addEventListener("load",()=>document.body.setAttribute("data-h",document.documentElement.scrollHeight))</script>';
  fs.writeFileSync(measureFile, html.replace('</body>', `${probe}</body>`));
  const dom = await run(edge, [...common, '--virtual-time-budget=3000', '--dump-dom', `file:///${measureFile.replace(/\\/g, '/')}`]);
  const m = /data-h="(\d+)"/.exec(dom);
  if (!m) throw new Error('Could not measure the ticket height');
  const heightMm = Math.ceil((Number(m[1]) * 25.4) / 96) + 1;

  // Pass 2: print to a PDF of exactly that size.
  const ticketFile = path.join(dir, 'ticket.html');
  const pdfFile = path.join(dir, 'ticket.pdf');
  fs.writeFileSync(ticketFile, html.replace('</head>', `<style>@page { size: 80mm ${heightMm}mm; margin: 0; }</style></head>`));
  await run(edge, [...common, '--no-pdf-header-footer', `--print-to-pdf=${pdfFile}`, `file:///${ticketFile.replace(/\\/g, '/')}`]);
  if (!fs.existsSync(pdfFile)) throw new Error('Edge did not produce a PDF');
  return pdfFile;
}

/**
 * Renders and prints the ticket. Throws on any failure — callers must not
 * mark the order 'printed' unless this resolves without throwing.
 */
async function printOrder(order) {
  if (!config.printerName) throw new Error('PRINTER_NAME is not set');
  const sumatra = findExe(config.sumatraPath, SUMATRA_CANDIDATES);
  if (!sumatra) throw new Error('SumatraPDF not found (set SUMATRA_PATH)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'countercall-kot-'));
  try {
    const pdf = await renderPdf(ticketHtml(order), dir);
    // Copies are separate sequential print jobs, not a driver "copies" option.
    for (let i = 0; i < config.printCopies; i += 1) {
      await run(sumatra, ['-print-to', config.printerName, '-silent', '-print-settings', 'noscale', pdf]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { printOrder, isPrinterReady, buildPreviewHtml };
