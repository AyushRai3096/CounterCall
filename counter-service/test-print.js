'use strict';

// Prints one sample KOT on the configured printer, to check printer setup
// without starting the relay or sending an order. Usage: npm run test-print
const printer = require('./src/printer');

const sample = {
  createdAt: new Date().toISOString(),
  kotNumber: 999,
  orderNumber: '123',
  items: [
    { name: 'Veg pan fried momos (10 pcs)', size: 'full', qty: 1, note: 'test print' },
    { name: 'Paneer pan fried momos (10 pcs)', size: 'full', qty: 1 },
    { name: 'Veg Afghani Chicken', size: 'full', qty: 1 }
  ],
};

printer
  .isPrinterReady()
  .then((ready) => (ready ? printer.printOrder(sample) : Promise.reject(new Error('not ready, see the warning above'))))
  .then(() => console.log('Sent to the printer.'))
  .catch((err) => {
    console.error(`Print failed: ${err.message}`);
    process.exitCode = 1;
  });
