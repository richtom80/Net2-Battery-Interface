/*
 * Connects to the Net2 SQL Server and hunts for tables/columns that look
 * like they hold door/battery status, so we can confirm the real schema
 * before writing the actual battery report against guessed names.
 *
 * Usage: node scripts/discover-schema.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, closeAll, sql } = require('../src/db');

const KEYWORDS = [
  'battery', 'door', 'lock', 'acu', 'controller', 'tamper',
  'voltage', 'signal', 'reader', 'wireless', 'status', 'online',
  'comms', 'health', 'alarm',
];

async function listDatabases() {
  try {
    const pool = await getPool('master');
    const result = await pool.request().query(
      "SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name"
    );
    return result.recordset.map((r) => r.name);
  } catch (err) {
    console.log(`  (could not list databases: ${err.message})`);
    return [];
  }
}

async function findMatchingColumns(database) {
  const pool = await getPool(database);
  const likeClauses = KEYWORDS
    .map((_, i) => `COLUMN_NAME LIKE @kw${i} OR TABLE_NAME LIKE @kw${i}`)
    .join(' OR ');

  const request = pool.request();
  KEYWORDS.forEach((kw, i) => request.input(`kw${i}`, sql.NVarChar, `%${kw}%`));

  const query = `
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE ${likeClauses}
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `;

  const result = await request.query(query);
  return result.recordset;
}

async function sampleRows(database, table) {
  const pool = await getPool(database);
  try {
    const result = await pool
      .request()
      .query(`SELECT TOP 3 * FROM [${table.replace(/]/g, '')}]`);
    return result.recordset;
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  console.log(`Connecting to ${process.env.DB_SERVER} ...`);

  console.log('\n== Databases visible on this server ==');
  const databases = await listDatabases();
  if (databases.length) {
    databases.forEach((d) => console.log(`  - ${d}`));
  } else {
    console.log('  (none listed, or master access denied - continuing with DB_DATABASE)');
  }

  const targetDb = process.env.DB_DATABASE || 'Net2';
  console.log(`\n== Scanning "${targetDb}" for door/battery related tables ==`);

  const matches = await findMatchingColumns(targetDb);
  if (!matches.length) {
    console.log('  No column/table names matched the keyword list. Try widening KEYWORDS in this script.');
    await closeAll();
    return;
  }

  const byTable = {};
  for (const row of matches) {
    byTable[row.TABLE_NAME] = byTable[row.TABLE_NAME] || [];
    byTable[row.TABLE_NAME].push(`${row.COLUMN_NAME} (${row.DATA_TYPE})`);
  }

  const output = {};
  for (const [table, columns] of Object.entries(byTable)) {
    console.log(`\n-- Table: ${table}`);
    console.log(`   Columns: ${columns.join(', ')}`);
    const sample = await sampleRows(targetDb, table);
    output[table] = { columns, sample };
    if (Array.isArray(sample)) {
      console.log(`   Sample rows (up to 3):`);
      sample.forEach((r, i) => console.log(`     [${i}] ${JSON.stringify(r)}`));
    } else {
      console.log(`   Could not sample rows: ${sample.error}`);
    }
  }

  const outPath = path.join(__dirname, 'discovery-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nFull results written to ${outPath}`);
  console.log('\nNext step: tell me which table/column actually represents battery level');
  console.log('(or paste the relevant block above back to me) and I will wire up the real report.');

  await closeAll();
}

main().catch((err) => {
  console.error('\nDiscovery failed:', err.message);
  console.error(err);
  process.exit(1);
});
