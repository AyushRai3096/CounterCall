'use strict';

// Crash/restart resilience: "start at sign-in" (Electron's own
// setLoginItemSettings) only covers signing in — it does nothing if the app
// dies mid-session (a crash, or someone clicking Quit). The user wants the
// app to never actually stop short of uninstalling or deleting it. The only
// mechanism this project trusts for "keep relaunching this process forever"
// is the same crash-restart-loop batch pattern relay-server already uses
// (see CLAUDE.md's "Windows auto-start") — this is that pattern, adapted to
// watch the packaged, installed exe instead of `node index.js`, and set up
// entirely by the app itself (no NSIS scripting, no separate file to copy
// alongside the installer).
//
// This SUPERSEDES app.setLoginItemSettings — don't run both, or two copies
// launch at sign-in (one via the registry Run key, one via this Startup
// shortcut).
//
// Poll-and-launch, not launch-and-wait-for-exit: the watchdog loop itself
// is also started immediately (not just registered for next sign-in), so a
// crash minutes after install self-heals without needing a reboot first.
// If it instead launched unconditionally every cycle, its very first
// iteration would race the already-running instance it was just started
// from — the new copy would hit requestSingleInstanceLock() and quit
// immediately, so the loop would just keep relaunching-and-quitting a copy
// every 5s for as long as the real instance stays up. Checking via
// `tasklist` first avoids that entirely.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');
const logger = require('./logger');

const EXE_NAME = 'CounterCall Counter App.exe';
const WATCHDOG_DIR = path.join(app.getPath('userData'), 'watchdog');
const BAT_PATH = path.join(WATCHDOG_DIR, 'watchdog.bat');
const VBS_PATH = path.join(WATCHDOG_DIR, 'watchdog.vbs');
const STARTUP_DIR = path.join(
  process.env.APPDATA || '',
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
);
const SHORTCUT_PATH = path.join(STARTUP_DIR, 'CounterCall Counter App Watchdog.lnk');

function ensureWatchdog() {
  // Only meaningful once installed — process.execPath in an unpackaged
  // `npm start` run points at node_modules/electron/dist/electron.exe, not
  // a stable installed location worth relaunching from.
  if (!app.isPackaged) return;

  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });

  const exePath = process.execPath;
  const batContent =
    '@echo off\r\n' +
    ':loop\r\n' +
    `tasklist /fi "imagename eq ${EXE_NAME}" | find /i "${EXE_NAME}" >nul\r\n` +
    'if errorlevel 1 (\r\n' +
    `  start "" "${exePath}"\r\n` +
    ')\r\n' +
    'timeout /t 5 /nobreak >nul\r\n' +
    'goto loop\r\n';
  fs.writeFileSync(BAT_PATH, batContent);

  const vbsContent =
    'Set objShell = CreateObject("WScript.Shell")\r\n' +
    `objShell.Run "cmd /c ""${BAT_PATH}""", 0, False\r\n`;
  fs.writeFileSync(VBS_PATH, vbsContent);

  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${SHORTCUT_PATH}'); ` +
      `$s.TargetPath='wscript.exe'; $s.Arguments='"${VBS_PATH}"'; $s.Save()`,
    ]);
  } catch (err) {
    logger.warn(`Could not create the watchdog Startup shortcut: ${err.message}`);
  }

  // Start the loop now too, so resilience doesn't wait for the next
  // sign-in — but only if one isn't already running. ensureWatchdog() runs
  // on every launch (including ones the watchdog itself triggered after a
  // crash), so without this check each relaunch would pile up another
  // redundant polling loop running forever alongside the earlier ones.
  //
  // Filter on Name = 'cmd.exe', not just CommandLine containing
  // "watchdog.bat" — the THIS check's own powershell.exe process
  // necessarily has "watchdog.bat" in ITS OWN command line too (it's
  // right there in the -Command string below), so a CommandLine-only
  // filter always matches itself and reports "yes" even when no loop is
  // actually running, silently skipping the start forever. The actual
  // loop always runs as cmd.exe (see watchdog.vbs: `cmd /c "..."`), and
  // this check's own process is powershell.exe, so filtering on Name
  // excludes the false self-match.
  try {
    const alreadyRunning = execFileSync('powershell', [
      '-NoProfile', '-Command',
      "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*watchdog.bat*' }) { 'yes' } else { 'no' }",
    ]).toString().trim();
    if (alreadyRunning === 'yes') {
      logger.info('Watchdog already running.');
    } else {
      execFileSync('wscript.exe', [VBS_PATH]);
      logger.info('Watchdog started — the app will relaunch within ~5s of any exit (crash, restart, or Quit).');
    }
  } catch (err) {
    logger.warn(`Could not start the watchdog loop: ${err.message}`);
  }
}

module.exports = { ensureWatchdog };
