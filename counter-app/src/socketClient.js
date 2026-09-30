'use strict';

const { io } = require('socket.io-client');
const config = require('./config');
const logger = require('./logger');

/**
 * Thin wrapper around a socket.io-client connection that reconnects on a
 * fixed backoff schedule (5s, 10s, 30s cap) rather than socket.io's default
 * jittered backoff, per spec. Emits high-level events via `on(event, cb)`:
 *   'connected'    - socket is up and registered
 *   'disconnected' - socket dropped
 *   'order:new'    - a fresh order pushed by the relay
 */
function createSocketClient() {
  const listeners = { connected: [], disconnected: [], 'order:new': [] };
  let socket = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;

  function emit(event, ...args) {
    for (const cb of listeners[event] || []) cb(...args);
  }

  function scheduleReconnect() {
    const delays = config.reconnectDelaysMs;
    const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
    reconnectAttempt += 1;
    logger.warn(`Relay disconnected. Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    socket = io(config.relayUrl, {
      reconnection: false, // we drive reconnection ourselves for exact backoff control
      query: { role: 'counter' },
      // Let socket.io negotiate transports (polling first, upgrade to
      // websocket) instead of forcing websocket-only — more tolerant of
      // network quirks (proxies, timing on the initial handshake) and
      // this is the source of truth for whether orders ever get printed,
      // so it should err on the side of connecting reliably.
    });

    socket.on('connect', () => {
      reconnectAttempt = 0;
      logger.info(`Connected to relay at ${config.relayUrl}`);
      socket.emit('counter:register');
      // Immediately ask for anything the relay queued while we were away.
      socket.emit('sync:request');
      emit('connected');
    });

    socket.on('disconnect', (reason) => {
      logger.warn(`Disconnected from relay: ${reason}`);
      emit('disconnected');
      socket.close();
      scheduleReconnect();
    });

    // A dropped connection fires 'disconnect' (handled above), but a
    // connection that never succeeds in the first place only ever fires
    // 'connect_error' — with reconnection:false, socket.io will not retry
    // that on its own, so this must also drive our backoff or the
    // service gets stuck offline forever after one failed attempt.
    socket.on('connect_error', (err) => {
      logger.warn(`Relay connect_error: ${err.message}`);
      socket.close();
      scheduleReconnect();
    });

    socket.on('order:new', (order) => emit('order:new', order));
  }

  return {
    connect,
    on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    send(event, payload) {
      if (socket && socket.connected) {
        socket.emit(event, payload);
      } else {
        logger.warn(`Cannot send '${event}' — socket not connected (order will surface again via sync:request)`);
      }
    },
  };
}

module.exports = { createSocketClient };
