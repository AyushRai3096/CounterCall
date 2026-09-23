'use strict';

/**
 * Single-counter restaurant: one in-memory queue, one counter socket.
 * All state is process-lifetime only — the counter service is the durable
 * source of truth. If this process restarts, in-flight orders are gone;
 * the PWA will time out waiting for a delivery ack and the user will see
 * the "not confirmed" warning, which is correct since whether the counter
 * actually got the order is genuinely unknown at that point.
 */

let counterSocketId = null;

// orderId -> order, insertion order preserved for FIFO flush.
const queue = new Map();

// orderId -> pwa socket id, so delivery/print/error events can be routed
// back to the client that submitted the order.
const originBySocket = new Map();

function registerCounterSocket(socketId) {
  counterSocketId = socketId;
}

function unregisterCounterSocket(socketId) {
  if (counterSocketId === socketId) {
    counterSocketId = null;
  }
}

function isCounterConnected() {
  return !!counterSocketId;
}

function getCounterSocketId() {
  return counterSocketId;
}

function enqueueOrder(order, originSocketId) {
  queue.set(order.orderId, order);
  if (originSocketId) originBySocket.set(order.orderId, originSocketId);
}

function getQueueSnapshot() {
  return Array.from(queue.values());
}

function removeFromQueue(orderId) {
  queue.delete(orderId);
}

function getOriginSocketId(orderId) {
  return originBySocket.get(orderId) || null;
}

function clearOrigin(orderId) {
  originBySocket.delete(orderId);
}

module.exports = {
  registerCounterSocket,
  unregisterCounterSocket,
  isCounterConnected,
  getCounterSocketId,
  enqueueOrder,
  getQueueSnapshot,
  removeFromQueue,
  getOriginSocketId,
  clearOrigin,
};
