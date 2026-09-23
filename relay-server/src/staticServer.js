'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const ROOT = path.resolve(config.pwaDir);

// Serves the mobile PWA's static files so the counter PC is the only
// thing that needs to be on. no-cache so menu.json edits reach phones
// on their next load.
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
