'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./logger');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    origin_device_id TEXT,
    restaurant TEXT,
    notes TEXT,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'printing', 'printed', 'error')),
    print_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const stmts = {
  insertIfNotExists: db.prepare(`
    INSERT OR IGNORE INTO orders
      (order_id, origin_device_id, restaurant, notes, items_json, status, print_attempts, created_at, updated_at)
    VALUES
      (@orderId, @originDeviceId, @restaurant, @notes, @itemsJson, 'pending', 0, @now, @now)
  `),
  get: db.prepare('SELECT * FROM orders WHERE order_id = ?'),
  setStatus: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?'),
  incrementAttempts: db.prepare(
    'UPDATE orders SET print_attempts = print_attempts + 1, updated_at = ? WHERE order_id = ?'
  ),
  deleteOrder: db.prepare('DELETE FROM orders WHERE order_id = ?'),
  getActive: db.prepare("SELECT * FROM orders WHERE status != 'printed' ORDER BY created_at ASC"),
};

function rowToOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    originDeviceId: row.origin_device_id,
    restaurant: row.restaurant,
    notes: row.notes,
    items: JSON.parse(row.items_json),
    status: row.status,
    printAttempts: row.print_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Insert the order as 'pending' if it isn't already known.
 * Returns { order, isNew } — isNew is false when this orderId was already
 * on disk (relay redelivery after a dropped ack), so callers can skip
 * re-printing.
 */
function insertOrder(order) {
  const now = new Date().toISOString();
  const info = stmts.insertIfNotExists.run({
    orderId: order.orderId,
    originDeviceId: order.originDeviceId || null,
    restaurant: order.restaurant || null,
    notes: order.notes || null,
    itemsJson: JSON.stringify(order.items || []),
    now,
  });
  const row = stmts.get.get(order.orderId);
  return { order: rowToOrder(row), isNew: info.changes === 1 };
}

function setStatus(orderId, status) {
  const now = new Date().toISOString();
  stmts.setStatus.run(status, now, orderId);
}

function incrementAttempts(orderId) {
  stmts.incrementAttempts.run(new Date().toISOString(), orderId);
}

function getOrder(orderId) {
  return rowToOrder(stmts.get.get(orderId));
}

function deleteOrder(orderId) {
  stmts.deleteOrder.run(orderId);
}

function getActiveOrders() {
  return stmts.getActive.all().map(rowToOrder);
}

module.exports = {
  insertOrder,
  setStatus,
  incrementAttempts,
  getOrder,
  deleteOrder,
  getActiveOrders,
};
