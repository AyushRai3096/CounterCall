'use strict';

// Prints via Electron's native print pipeline, per KOT_TEMPLATE_SPEC.md
// section 5 (written for exactly this setup — the source app was Electron
// too). This replaces counter-service's HTML -> Edge headless -> PDF ->
// SumatraPDF pipeline entirely; there is no PDF step here.

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const config = require('./config');
const logger = require('./logger');
const { buildKotText, toPrintableHtml } = require('./kotTemplate');

fs.mkdirSync(config.kotTmpDir, { recursive: true });

const PRINT_TIMEOUT_MS = 20000;
const SETTLE_MS = 250; // let layout/first paint settle before printing (spec §5.3)

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Fixed/estimated page height, same reasoning as the old counter-service
// pipeline's printer.js: without an explicit pageSize, Chromium asks the
// PRINTER DRIVER for its currently-configured default paper size instead of
// using our CSS @page rule — and that default may not actually be the tall
// custom 80x297mm form, producing a short blank strip instead of a ticket.
// Passing pageSize in microns sidesteps the driver default entirely. Erring
// tall just feeds a bit more blank paper, which is always safe on a
// continuous roll — never make this tighter in a way that risks cutting off
// content.
const FIXED_HEIGHT_MM = 297;
const PAGE_WIDTH_MICRONS = 80000; // 80mm

function estimateHeightMm(order) {
  const HEADER_MM = 30;
  const TAIL_MM = 55; // the template's own bottom padding — always reserved
  const NAME_COL_CHARS_PER_LINE = 16;
  const NOTE_COL_CHARS_PER_LINE = 10;
  const MM_PER_LINE = 4.5;

  const itemsMm = order.items.reduce((sum, item) => {
    const nameLines = Math.ceil((item.name || '').length / NAME_COL_CHARS_PER_LINE) || 1;
    const noteLines = Math.ceil((item.note || '').length / NOTE_COL_CHARS_PER_LINE) || 1;
    return sum + Math.max(nameLines, noteLines) * MM_PER_LINE;
  }, 0);

  return Math.ceil(HEADER_MM + itemsMm + TAIL_MM);
}

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

async function getInstalledPrinterNames() {
  const win = new BrowserWindow({ show: false });
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => p.name);
  } finally {
    win.destroy();
  }
}

// Checks PRINTER_NAME is spelled exactly as Windows has it — a typo here
// otherwise only surfaces as a silently ignored/misrouted print job.
async function isPrinterReady() {
  if (!config.printerName) {
    logger.warn('Printing is not ready: PRINTER_NAME is not set');
    return false;
  }
  const names = await getInstalledPrinterNames();
  if (!names.includes(config.printerName)) {
    logger.warn(
      `Printing is not ready: no Windows printer named "${config.printerName}" — check Settings > Printers ` +
      '& scanners for the exact name (PRINTER_NAME in .env must match exactly)'
    );
    return false;
  }
  return true;
}

function printOnce(win, deviceName, heightMicrons) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A stuck spooler must not hang the order pipeline forever.
      reject(new Error('Print timed out after 20s (stuck spooler?)'));
    }, PRINT_TIMEOUT_MS);

    win.webContents.print(
      {
        silent: true,
        printBackground: false,
        margins: { marginType: 'none' },
        deviceName,
        pageSize: { width: PAGE_WIDTH_MICRONS, height: heightMicrons },
      },
      (success, failureReason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (success) resolve();
        else reject(new Error(`Print failed: ${failureReason}`));
      }
    );
  });
}

/**
 * Renders and prints the ticket. Throws on any failure — callers must not
 * mark the order 'printed' unless this resolves without throwing.
 */
async function printOrder(order) {
  if (!config.printerName) throw new Error('PRINTER_NAME is not set');
  const names = await getInstalledPrinterNames();
  if (!names.includes(config.printerName)) {
    throw new Error(`No Windows printer named "${config.printerName}" (check PRINTER_NAME in .env)`);
  }

  const dir = fs.mkdtempSync(path.join(config.kotTmpDir, 'kot-'));
  const ticketFile = path.join(dir, 'ticket.html');
  fs.writeFileSync(ticketFile, ticketHtml(order));

  // A show:false window can have its rendering throttled/skipped by
  // Chromium entirely (regressed vs. what KOT_TEMPLATE_SPEC.md's source app
  // saw on an older Electron) — print() then gets an unpainted frame and
  // the printer feeds a blank strip. Fix: actually show the window, but
  // positioned far off any real monitor, so Chromium paints it normally
  // while nothing is ever visible to the user. Load from a real file, not
  // a data: URL — print() renders blank for data: URIs either way.
  const win = new BrowserWindow({
    x: -2000,
    y: -2000,
    show: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    await win.loadFile(ticketFile);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const heightMicrons = Math.max(FIXED_HEIGHT_MM, estimateHeightMm(order)) * 1000;
    for (let i = 0; i < config.printCopies; i += 1) {
      // Copies are separate sequential print jobs (await each before the
      // next), not the `copies` print option — see spec §5.5.
      // eslint-disable-next-line no-await-in-loop
      await printOnce(win, config.printerName, heightMicrons);
    }
  } finally {
    win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { printOrder, isPrinterReady, getInstalledPrinterNames };
