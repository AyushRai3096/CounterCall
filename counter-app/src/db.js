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
    order_number TEXT,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'printing', 'printed', 'error')),
    print_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT OR IGNORE INTO meta (key, value) VALUES ('kot_number', 0);
`);

// CREATE TABLE IF NOT EXISTS won't add columns to a database file created by an
// older version, so add any that are missing.
const existingColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
for (const [name, type] of [['restaurant', 'TEXT'], ['order_number', 'TEXT'], ['kot_number', 'INTEGER']]) {
  if (!existingColumns.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
}

const stmts = {
  insertIfNotExists: db.prepare(`
    INSERT OR IGNORE INTO orders
      (order_id, origin_device_id, restaurant, order_number, kot_number, items_json, status, print_attempts, created_at, updated_at)
    VALUES
      (@orderId, @originDeviceId, @restaurant, @orderNumber, @kotNumber, @itemsJson, 'pending', 0, @now, @now)
  `),
  get: db.prepare('SELECT * FROM orders WHERE order_id = ?'),
  nextKot: db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'kot_number' RETURNING value"),
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
    orderNumber: row.order_number,
    kotNumber: row.kot_number,
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
  const insert = db.transaction(() => {
    const already = stmts.get.get(order.orderId);
    if (already) return { row: already, isNew: false };
    // The KOT number is only consumed for orders we haven't seen before, so a
    // relay redelivery never burns a number.
    const kotNumber = stmts.nextKot.get().value;
    stmts.insertIfNotExists.run({
      orderId: order.orderId,
      originDeviceId: order.originDeviceId || null,
      restaurant: order.restaurant || null,
      orderNumber: order.orderNumber || null,
      kotNumber,
      itemsJson: JSON.stringify(order.items || []),
      now,
    });
    return { row: stmts.get.get(order.orderId), isNew: true };
  });
  const { row, isNew } = insert();
  return { order: rowToOrder(row), isNew };
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
