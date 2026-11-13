require('dotenv').config();

function buildSqlConfig(database) {
  const authType = (process.env.DB_AUTH_TYPE || 'sql').toLowerCase();

  const base = {
    server: process.env.DB_SERVER,
    database: database || process.env.DB_DATABASE || 'Net2',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
      enableArithAbort: true,
    },
    connectionTimeout: 10000,
    requestTimeout: 15000,
  };

  if (process.env.DB_PORT) {
    base.port = Number(process.env.DB_PORT);
  } else if (process.env.DB_INSTANCE) {
    base.options.instanceName = process.env.DB_INSTANCE;
  }

  if (authType === 'ntlm') {
    base.authentication = {
      type: 'ntlm',
      options: {
        domain: process.env.DB_DOMAIN || '',
        userName: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      },
    };
  } else {
    base.user = process.env.DB_USER;
    base.password = process.env.DB_PASSWORD;
  }

  return base;
}

module.exports = { buildSqlConfig };
