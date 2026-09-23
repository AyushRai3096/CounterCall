'use strict';

const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const queueManager = require('./queueManager');
const staticServer = require('./staticServer');

// socket.io intercepts /socket.io/ requests itself; everything else is
// either the health check or a PWA static file.
const httpServer = http.createServer((req, res) => {
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function flushQueueToCounter() {
  const socketId = queueManager.getCounterSocketId();
  if (!socketId) return;
  const orders = queueManager.getQueueSnapshot();
  if (orders.length === 0) return;
  log(`Flushing ${orders.length} queued order(s) to the counter`);
  for (const order of orders) {
    io.to(socketId).emit('order:new', order);
  }
}

io.on('connection', (socket) => {
  const { role, deviceId } = socket.handshake.query;

  if (role === 'counter') {
    handleCounterConnection(socket);
  } else {
    handlePwaConnection(socket, deviceId);
  }
});

function handleCounterConnection(socket) {
  // Register on the raw connection so a counter that reconnects without
  // sending explicit events is still routable. Queue flushing only ever
  // happens from the explicit 'sync:request' below — registering here AND
  // on 'counter:register' AND on 'sync:request' would flush the same
  // queue multiple times per reconnect, since the counter service sends
  // all of these in a burst right after connecting.
  log(`Counter connected (socket=${socket.id})`);
  queueManager.registerCounterSocket(socket.id);

  socket.on('counter:register', () => {
    queueManager.registerCounterSocket(socket.id);
  });

  socket.on('sync:request', () => {
    flushQueueToCounter();
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
    log(`Counter disconnected (socket=${socket.id})`);
    queueManager.unregisterCounterSocket(socket.id);
  });
}

function handlePwaConnection(socket, deviceId) {
  log(`PWA client connected (device=${deviceId || 'unknown'}, socket=${socket.id})`);

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
    log(`Order ${enrichedOrder.orderId} queued`);

    if (queueManager.isCounterConnected()) {
      io.to(queueManager.getCounterSocketId()).emit('order:new', enrichedOrder);
    } else {
      log(`Counter offline — order ${enrichedOrder.orderId} held in relay queue.`);
    }
  });

  socket.on('disconnect', () => {
    log(`PWA client disconnected (socket=${socket.id})`);
  });
}

httpServer.listen(config.port, () => {
  log(`Relay server listening on :${config.port}`);
});
