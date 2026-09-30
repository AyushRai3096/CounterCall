'use strict';

// Best-effort: if Tailscale is already installed AND already signed in on
// this machine, enable Funnel on the relay's port automatically so there's
// nothing to run by hand. This does NOT install Tailscale and does NOT
// sign it in — both are one-time, interactive, human steps (a real
// VPN/auth flow) that no installer can safely automate. On a counter PC
// that's never had Tailscale set up before, this is a no-op (logged, not
// thrown) and that one-time setup still has to happen by hand once. See
// CLAUDE.md's "Merging relay-server into counter-app" section.

const fs = require('fs');
const { execFile } = require('child_process');
const logger = require('./logger');

const CANDIDATES = [
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
];

function findTailscale() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout)
    );
  });
}

async function ensureFunnel(port) {
  const exe = findTailscale();
  if (!exe) {
    logger.warn('[tailscale] Not installed on this machine — skipping Funnel setup. ' +
      'Install Tailscale and sign in once, then this will pick it up on next launch.');
    return;
  }

  try {
    await run(exe, ['funnel', '--bg', String(port)]);
    logger.info(`[tailscale] Funnel enabled on :${port}.`);
  } catch (err) {
    // Most likely cause: not signed in yet (a one-time, interactive step —
    // see the module comment above). Log it plainly rather than treat it
    // as a hard failure; printing/relay still work fine on the local
    // network either way.
    logger.warn(`[tailscale] Could not enable Funnel (is it signed in? run "tailscale up" once if not): ${err.message}`);
  }
}

module.exports = { ensureFunnel };
