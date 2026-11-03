const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] Falta la variable de entorno DATABASE_URL. Copiá .env.example a .env y completala.');
}

// Pool chico: en Vercel cada instancia de la función tiene su propio pool, así que
// conviene pocas conexiones por instancia. En DATABASE_URL usá la cadena "pooled" de Neon
// (el host contiene "-pooler"), que reparte las conexiones entre todas las instancias.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});

module.exports = pool;
