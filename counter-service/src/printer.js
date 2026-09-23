'use strict';

const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const config = require('./config');
const logger = require('./logger');

const TYPE_MAP = {
  epson: PrinterTypes.EPSON,
  star: PrinterTypes.STAR,
  tanca: PrinterTypes.TANCA,
  daruma: PrinterTypes.DARUMA,
};

function createPrinter() {
  return new ThermalPrinter({
    type: TYPE_MAP[config.printerType.toLowerCase()] || PrinterTypes.EPSON,
    interface: config.printerInterface,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

const printer = createPrinter();

async function isPrinterReady() {
  try {
    return await printer.isPrinterConnected();
  } catch (err) {
    logger.warn(`Printer connectivity check failed: ${err.message}`);
    return false;
  }
}

function formatItemLine(item) {
  const size = item.size ? ` (${item.size})` : '';
  return `${item.qty} x ${item.name}${size}`;
}

/**
 * Plain-text rendering of the same ticket content printOrder() sends to
 * the real printer, for the dev-mode browser preview.
 */
function buildPreviewLines(order) {
  const lines = [];
  // The restaurant on the order (one of the brands sharing this printer)
  // takes priority over the generic configured name — that's the single
  // most important thing on the ticket when two brands share one printer.
  lines.push(order.restaurant || config.restaurantName);
  lines.push('-'.repeat(32));
  lines.push(`Order: ${order.orderId.slice(0, 8)}`);
  lines.push(`Time:  ${new Date(order.createdAt).toLocaleString()}`);
  lines.push('-'.repeat(32));
  for (const item of order.items) lines.push(formatItemLine(item));
  if (order.notes) {
    lines.push('-'.repeat(32));
    lines.push(`Notes: ${order.notes}`);
  }
  return lines;
}

/**
 * Builds and sends the ticket. Throws on any failure — callers must not
 * mark the order 'printed' unless this resolves without throwing.
 */
async function printOrder(order) {
  printer.clear();
  printer.alignCenter();
  printer.bold(true);
  // Same priority as buildPreviewLines: the order's own restaurant
  // (Angara Junction / Steam and Sauces / etc.) over the generic
  // configured name, since that's the first thing kitchen staff need
  // to see with two brands sharing one printer.
  printer.println(order.restaurant || config.restaurantName);
  printer.bold(false);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Order: ${order.orderId.slice(0, 8)}`);
  printer.println(`Time:  ${new Date(order.createdAt).toLocaleString()}`);
  printer.drawLine();

  printer.setTextDoubleHeight();
  for (const item of order.items) {
    printer.println(formatItemLine(item));
  }
  printer.setTextNormal();

  if (order.notes) {
    printer.drawLine();
    printer.println(`Notes: ${order.notes}`);
  }

  printer.drawLine();
  printer.cut();

  await printer.execute();
}

module.exports = { printOrder, isPrinterReady, buildPreviewLines };
