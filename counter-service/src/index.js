'use strict';

const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const printer = require('./printer');
const devPreviewServer = require('./devPreviewServer');
const { createSocketClient } = require('./socketClient');

const MAX_PRINT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

const socketClient = createSocketClient();

async function attemptPrint(order) {
  db.setStatus(order.orderId, 'printing');
  logger.transition(order.orderId, 'pending', 'printing');

  try {
    if (config.devMode) {
      await devPreviewServer.requestPreview(order, printer.buildPreviewHtml(order));
    } else {
      await printer.printOrder(order);
    }
    db.setStatus(order.orderId, 'printed');
    logger.transition(order.orderId, 'printing', 'printed');
    socketClient.send('order:printed', { orderId: order.orderId });
    // Active queue only — nothing to keep once it's printed.
    db.deleteOrder(order.orderId);
  } catch (err) {
    db.incrementAttempts(order.orderId);
    const fresh = db.getOrder(order.orderId);
    logger.error(`Print failed for order=${order.orderId} attempt=${fresh.printAttempts}: ${err.message}`);

    if (fresh.printAttempts >= MAX_PRINT_ATTEMPTS) {
      db.setStatus(order.orderId, 'error');
      logger.transition(order.orderId, 'printing', 'error (needs manual review)');
      socketClient.send('order:error', {
        orderId: order.orderId,
        message: `Printing failed after ${fresh.printAttempts} attempts: ${err.message}`,
      });
    } else {
      // We know for certain this attempt did not produce a printed ticket
      // (the exception was caught before completion), so a bounded retry
      // is safe — unlike a crash mid-print, where physical print state is
      // unknown and auto-retry is never allowed.
      db.setStatus(order.orderId, 'pending');
      logger.transition(order.orderId, 'printing', 'pending (retry scheduled)');
      setTimeout(() => attemptPrint(db.getOrder(order.orderId)), RETRY_DELAY_MS);
    }
  }
}

function handleIncomingOrder(order) {
  if (!order || !order.orderId || !Array.isArray(order.items)) {
    logger.error(`Received malformed order payload: ${JSON.stringify(order)}`);
    return;
  }

  // Persist BEFORE anything else — this is the durability guarantee.
  const { order: stored, isNew } = db.insertOrder(order);

  if (!isNew) {
    // Relay redelivered an order we already know about (e.g. our ack was
    // lost and the relay replayed its queue on reconnect). Don't reprint.
    if (stored.status === 'printed') {
      socketClient.send('order:printed', { orderId: stored.orderId });
    } else if (stored.status === 'error' || stored.status === 'printing') {
      logger.warn(`Ignoring redelivery of order=${stored.orderId}, already flagged/in-flight (status=${stored.status})`);
    } else {
      // status === 'pending' and not new just means we already have it
      // queued; fall through to (re)send the delivery ack + print attempt.
      logger.info(`Redelivery of already-pending order=${stored.orderId}`);
    }
    if (stored.status !== 'pending') return;
  } else {
    logger.transition(stored.orderId, 'none', 'pending');
  }

  socketClient.send('order:delivered', { orderId: stored.orderId });

  attemptPrint(stored);
}

function resumeOnStartup() {
  const active = db.getActiveOrders();
  if (active.length === 0) {
    logger.info('No active orders to resume on startup.');
    return;
  }

  for (const order of active) {
    if (order.status === 'printing') {
      // Unknown whether the printer actually finished before the crash.
      // Never auto-reprint — a duplicate ticket is worse than a delay.
      logger.error(
        `NEEDS MANUAL REVIEW: order=${order.orderId} was mid-print when the service last stopped. ` +
        `Check the printer/ticket manually, then resolve it directly in the database.`
      );
    } else if (order.status === 'pending') {
      logger.info(`Resuming pending order=${order.orderId} from previous run.`);
      attemptPrint(order);
    } else if (order.status === 'error') {
      logger.warn(`Order=${order.orderId} remains flagged for manual review (status=error).`);
    }
  }
}

async function main() {
  logger.info('Counter service starting');

  if (config.devMode) {
    devPreviewServer.start();
    logger.info('Dev mode enabled — real printer disabled, using browser preview instead.');
  } else {
    const printerReady = await printer.isPrinterReady();
    if (!printerReady) {
      logger.warn('Printer not reachable at startup — will still queue/persist orders and retry printing.');
    }
  }

  resumeOnStartup();

  socketClient.on('order:new', handleIncomingOrder);
  socketClient.on('connected', () => logger.info('Relay connection established.'));
  socketClient.on('disconnected', () => logger.warn('Relay connection lost.'));
  socketClient.connect();
}

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err && err.stack ? err.stack : err}`);
});

main();
