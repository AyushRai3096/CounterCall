'use strict';

// The relay, embedded. Ported from relay-server/src/index.js — protocol
// and behavior unchanged (see relay-server/README.md for the full
// Socket.io protocol), just started as a function instead of running at
// require-time, and logging through counter-app's shared logger (so relay
// activity and print activity land in the same counter-app.log) instead
// of relay-server's own plain console.log.
//
// Why this exists here at all: see CLAUDE.md's "Merging relay-server into
// counter-app" section. Short version — the user wanted exactly one
// installer with zero separate manual setup steps; relay-server was
// simple enough (plain Node + socket.io, no native deps) to embed directly
// rather than keep it a separate process the user has to remember to
// start.

const http = require('http');
const { Server } = require('socket.io');
const logger = require('../logger');
const queueManager = require('./queueManager');
const staticServer = require('./staticServer');

let httpServer = null;

function flushQueueToCounter(io) {
  const socketId = queueManager.getCounterSocketId();
  if (!socketId) return;
  const orders = queueManager.getQueueSnapshot();
  if (orders.length === 0) return;
  logger.info(`[relay] Flushing ${orders.length} queued order(s) to the counter`);
  for (const order of orders) {
    io.to(socketId).emit('order:new', order);
  }
}

function handleCounterConnection(io, socket) {
  // Register on the raw connection so a counter that reconnects without
  // sending explicit events is still routable. Queue flushing only ever
  // happens from the explicit 'sync:request' below — registering here AND
  // on 'counter:register' AND on 'sync:request' would flush the same
  // queue multiple times per reconnect, since the counter side sends all
  // of these in a burst right after connecting.
  logger.info(`[relay] Counter connected (socket=${socket.id})`);
  queueManager.registerCounterSocket(socket.id);

  socket.on('counter:register', () => {
    queueManager.registerCounterSocket(socket.id);
  });

  socket.on('sync:request', () => {
    flushQueueToCounter(io);
  });

  socket.on('order:delivered', ({ orderId }) => {
    const originSocketId = queueManager.getOriginSocketId(orderId);
    // The counter has durably written the order to its own disk — the
    // relay no longer needs to hold it for redelivery.
    queueManager.removeFromQueue(orderId);
    if (originSocketId) io.to(originSocketId).emit('order:delivered', { orderId });
  });

  socket.on('order:printed', ({ orderId }) => {
    const originSocketId = queueManager.getOriginSocketId(orderId);
    queueManager.removeFromQueue(orderId);
    if (originSocketId) io.to(originSocketId).emit('order:printed', { orderId });
    queueManager.clearOrigin(orderId);
  });

  socket.on('order:error', ({ orderId, message }) => {
    const originSocketId = queueManager.getOriginSocketId(orderId);
    queueManager.removeFromQueue(orderId);
    if (originSocketId) io.to(originSocketId).emit('order:error', { orderId, message });
    queueManager.clearOrigin(orderId);
  });

  socket.on('disconnect', () => {
    logger.info(`[relay] Counter disconnected (socket=${socket.id})`);
    queueManager.unregisterCounterSocket(socket.id);
  });
}

function handlePwaConnection(io, socket, deviceId) {
  logger.info(`[relay] PWA client connected (device=${deviceId || 'unknown'}, socket=${socket.id})`);

  socket.on('order:submit', (order) => {
    if (!order || !order.orderId || !Array.isArray(order.items) || order.items.length === 0) {
      socket.emit('order:error', {
        orderId: order && order.orderId,
        message: 'Malformed order payload.',
      });
      return;
    }

    const enrichedOrder = {
      ...order,
      originDeviceId: deviceId || order.originDeviceId || null,
      createdAt: order.createdAt || new Date().toISOString(),
    };

    queueManager.enqueueOrder(enrichedOrder, socket.id);
    logger.info(`[relay] Order ${enrichedOrder.orderId} queued`);

    if (queueManager.isCounterConnected()) {
      io.to(queueManager.getCounterSocketId()).emit('order:new', enrichedOrder);
    } else {
      logger.warn(`[relay] Counter offline — order ${enrichedOrder.orderId} held in relay queue.`);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`[relay] PWA client disconnected (socket=${socket.id})`);
  });
}

function start(port) {
  if (httpServer) return; // already started — idempotent, safe to call more than once

  // socket.io intercepts /socket.io/ requests itself; everything else is
  // either the health check or a PWA static file.
  httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    staticServer.handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    const { role, deviceId } = socket.handshake.query;
    if (role === 'counter') {
      handleCounterConnection(io, socket);
    } else {
      handlePwaConnection(io, socket, deviceId);
    }
  });

  httpServer.listen(port, () => {
    logger.info(`[relay] Relay listening on :${port}`);
  });
}

module.exports = { start };
