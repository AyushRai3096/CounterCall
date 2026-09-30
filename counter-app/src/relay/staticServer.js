'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

// mobile-pwa/public isn't part of this package — it's copied in at build
// time by electron-builder's `extraResources` (see package.json's `build`
// config) since a packaged app has no sibling folders on the target
// machine to read it from directly, unlike relay-server's original
// __dirname-relative path. Unpackaged (`npm start`), the sibling folder in
// the actual repo is used instead, matching relay-server's original
// behavior exactly for local dev.
const ROOT = path.resolve(
  process.env.PWA_DIR ||
    (app.isPackaged
      ? path.join(process.resourcesPath, 'mobile-pwa-public')
      : path.join(__dirname, '..', '..', '..', 'mobile-pwa', 'public'))
);

// Serves the mobile PWA's static files so the counter PC is the only
// thing that needs to be on. no-cache so menu.json edits reach phones
// on their next load. Ported from relay-server/src/staticServer.js —
// unchanged except for ROOT's resolution above.
function handle(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  let filePath;
  try {
    filePath = path.resolve(ROOT, '.' + decodeURIComponent(urlPath));
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

module.exports = { handle };
