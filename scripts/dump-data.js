/*
 * Prints current battery data as JSON to stdout, for feeding into
 * scripts/make-report.py. Usage: node scripts/dump-data.js > battery-data.json
 */
require('dotenv').config();
const { getBatteryLevels } = require('../src/queries/batteryLevels');
const { closeAll } = require('../src/db');

(async () => {
  const levels = await getBatteryLevels();
  process.stdout.write(JSON.stringify({ fetchedAt: new Date().toISOString(), levels }, null, 2));
  await closeAll();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
