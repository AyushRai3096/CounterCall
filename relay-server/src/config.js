'use strict';

const path = require('path');

module.exports = {
  port: process.env.PORT || 4000,
  // The relay also serves the mobile PWA so the counter PC is the only
  // machine that has to be on. Override if the PWA lives elsewhere.
  pwaDir: process.env.PWA_DIR || path.join(__dirname, '..', '..', 'mobile-pwa', 'public'),
};
