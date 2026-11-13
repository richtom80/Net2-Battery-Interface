const sql = require('mssql');
const { buildSqlConfig } = require('./config');

const pools = new Map();

async function getPool(database) {
  const key = database || '__default__';
  if (pools.has(key)) return pools.get(key);

  const pool = new sql.ConnectionPool(buildSqlConfig(database));
  const connectPromise = pool.connect().then(() => pool);
  pools.set(key, connectPromise);
  return connectPromise;
}

async function closeAll() {
  for (const poolPromise of pools.values()) {
    const pool = await poolPromise.catch(() => null);
    if (pool) await pool.close().catch(() => {});
  }
  pools.clear();
}

module.exports = { getPool, closeAll, sql };
