// Ejecuta schema.sql contra la base de datos configurada en DATABASE_URL.
// Uso: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  console.log('Aplicando schema.sql...');
  await pool.query(sql);
  console.log('✔ Listo. Tablas creadas (o ya existentes).');
  await pool.end();
}

main().catch(err => {
  console.error('✘ Error al migrar:', err.message);
  process.exit(1);
});
