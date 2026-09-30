'use strict';

// The only UI this app ever shows: a tray icon so the printer can be picked
// once and stays picked (writes to .env via config.setPrinterName), instead
// of hand-editing .env or running a separate setup script. Everything else
// stays hidden, per the project's "no UI in production" design (see
// CLAUDE.md) — this is a control surface, not a dashboard.

const { Tray, Menu, nativeImage, shell, app, dialog } = require('electron');
const config = require('./config');
const logger = require('./logger');

// A small solid-color dot, embedded as a data URL so no separate asset file
// is needed (nativeImage.createEmpty() renders as an invisible/blank tray
// icon on Windows — easy to miss entirely, which is what happened during
// testing: the app was running fine, there was just nothing visible to
// click).
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAUwTpv5HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAyYlV7AkM5eUAAAAASUVORK5CYII=';

let tray = null;

async function buildMenu(getInstalledPrinterNames) {
  let names = [];
  try {
    names = await getInstalledPrinterNames();
  } catch (err) {
    logger.warn(`Could not list printers for tray menu: ${err.message}`);
  }

  const printerItems = names.length
    ? names.map((name) => ({
        label: name,
        type: 'radio',
        checked: name === config.printerName,
        click: () => {
          config.setPrinterName(name);
          logger.info(`Printer set to "${name}" via tray menu.`);
          refreshMenu(getInstalledPrinterNames);
        },
      }))
    : [{ label: 'No printers found', enabled: false }];

  return Menu.buildFromTemplate([
    { label: 'CounterCall Counter App', enabled: false },
    { label: `Printer: ${config.printerName || '(none selected)'}`, enabled: false },
    { type: 'separator' },
    ...printerItems,
    { type: 'separator' },
    { label: 'Open Log File', click: () => shell.openPath(config.logPath) },
    { type: 'separator' },
    {
      label: 'Restart',
      click: () => {
        // The watchdog (src/watchdog.js) relaunches the app within ~5s of
        // any exit, so "Quit" is really "restart" now — still confirmed so
        // a stray click can't cause a pointless few-second printing gap.
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Cancel', 'Restart'],
          defaultId: 0,
          cancelId: 0,
          message: 'Restart CounterCall Counter App?',
          detail: 'It will relaunch automatically within a few seconds.',
        });
        if (choice === 1) {
          logger.info('Restart via tray menu (confirmed).');
          app.quit();
        }
      },
    },
  ]);
}

async function refreshMenu(getInstalledPrinterNames) {
  if (!tray) return;
  tray.setContextMenu(await buildMenu(getInstalledPrinterNames));
  tray.setToolTip(`CounterCall Counter App — ${config.printerName || 'no printer selected'}`);
}

function createTray(getInstalledPrinterNames) {
  tray = new Tray(nativeImage.createFromDataURL(ICON_DATA_URL));
  tray.setToolTip(`CounterCall Counter App — ${config.printerName || 'no printer selected'}`);
  refreshMenu(getInstalledPrinterNames);
  return tray;
}

module.exports = { createTray };
