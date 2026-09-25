'use strict';

const http = require('http');
const config = require('./config');
const logger = require('./logger');

/**
 * Stand-in for the real printer during development. Instead of really
 * printing, each print attempt is queued here and shown as a
 * ticket preview on a tiny local web page with Accept/Reject buttons —
 * Accept resolves the pending print (simulating a successful print),
 * Reject rejects it (simulating a printer failure), so the retry/error
 * flagging path can be exercised without real hardware.
 */

// Queue of { orderId, html, resolve, reject }. Only the front item is
// shown; a single operator clicks through them one at a time.
const queue = [];

function requestPreview(order, html) {
  return new Promise((resolve, reject) => {
    queue.push({ orderId: order.orderId, html, resolve, reject });
  });
}

function currentPreview() {
  return queue.length > 0 ? { orderId: queue[0].orderId, html: queue[0].html } : null;
}

function resolveCurrent(outcome) {
  const item = queue.shift();
  if (!item) return false;
  if (outcome === 'accept') {
    item.resolve();
  } else {
    item.reject(new Error('Rejected in dev print preview'));
  }
  return true;
}

function renderPage() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CounterCall — Print Preview</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #f2ede8; margin: 0; padding: 24px; color: #241814; }
  h1 { font-size: 1.1rem; margin: 0 0 16px; }
  .ticket { background: white; border: 1px solid #ddd; border-radius: 10px; width: 320px; height: 420px; margin-bottom: 16px; }
  .queue-note { font-size: 0.85rem; color: #8a7a72; margin-bottom: 16px; }
  .buttons { display: flex; gap: 12px; max-width: 320px; }
  button { flex: 1; padding: 12px; font-size: 1rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; }
  #accept { background: #2f8f4e; color: white; }
  #reject { background: #c0392b; color: white; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
</head>
<body>
<h1>Print Preview (dev mode)</h1>
<div class="queue-note" id="queue-note"></div>
<iframe class="ticket" id="ticket" srcdoc="Loading…"></iframe>
<div class="buttons">
  <button id="accept">Accept (simulate printed)</button>
  <button id="reject">Reject (simulate failure)</button>
</div>
<script>
async function poll() {
  const res = await fetch('/state');
  const data = await res.json();
  const ticket = document.getElementById('ticket');
  const note = document.getElementById('queue-note');
  const accept = document.getElementById('accept');
  const reject = document.getElementById('reject');
  if (data.pending) {
    if (ticket.dataset.orderId !== data.pending.orderId) {
      ticket.srcdoc = data.pending.html;
      ticket.dataset.orderId = data.pending.orderId;
    }
    accept.disabled = false;
    reject.disabled = false;
  } else {
    if (ticket.dataset.orderId !== '') {
      ticket.srcdoc = '<p style="font-family:sans-serif;color:#8a7a72">No print waiting.</p>';
      ticket.dataset.orderId = '';
    }
    accept.disabled = true;
    reject.disabled = true;
  }
  note.textContent = data.queueLength > 1 ? (data.queueLength - 1) + ' more waiting after this one' : '';
}
document.getElementById('accept').addEventListener('click', async () => {
  await fetch('/accept', { method: 'POST' });
  poll();
});
document.getElementById('reject').addEventListener('click', async () => {
  await fetch('/reject', { method: 'POST' });
  poll();
});
poll();
setInterval(poll, 1000);
</script>
</body>
</html>`;
}

let server = null;

function start() {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderPage());
      return;
    }
    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pending: currentPreview(), queueLength: queue.length }));
      return;
    }
    if (req.method === 'POST' && req.url === '/accept') {
      resolveCurrent('accept');
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'POST' && req.url === '/reject') {
      resolveCurrent('reject');
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Dev preview port ${config.devPreviewPort} is already in use — another counter-service ` +
        `instance is almost certainly still running. Stop it before starting a new one; otherwise ` +
        `new orders silently go to whichever instance the relay is talking to while the browser ` +
        `preview stays stuck on the other one.`
      );
    } else {
      logger.error(`Dev preview server failed: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(config.devPreviewPort, () => {
    logger.info(`Dev print preview at http://localhost:${config.devPreviewPort}`);
  });
}

module.exports = { start, requestPreview };
