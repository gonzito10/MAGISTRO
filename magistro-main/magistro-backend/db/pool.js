const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] Falta la variable de entorno DATABASE_URL. Copiá .env.example a .env y completala.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = pool;
