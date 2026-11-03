// Notificaciones push (Web Push). Se activan solo si están las claves VAPID
// en las variables de entorno; si faltan, todo funciona igual pero sin avisos.
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional)
// Generar claves una sola vez con:  npm run vapid
const webpush = require('web-push');
const pool = require('../db/pool');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://magistro.vercel.app';

let habilitado = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    habilitado = true;
  } catch (err) {
    console.error('Claves VAPID inválidas; las notificaciones quedan desactivadas:', err.message);
  }
}

// Nunca lanza: un fallo al notificar no debe romper el envío del mensaje.
async function enviar(subs, payload) {
  if (!habilitado || !subs || !subs.length) return;
  const body = JSON.stringify(payload);
  await Promise.allSettled(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 * 24, timeout: 5000 }
      );
    } catch (err) {
      // 404/410: el dispositivo ya no existe o revocó el permiso → se borra.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await pool.query('DELETE FROM push_subs WHERE endpoint = $1', [s.endpoint]).catch(() => {});
      } else {
        console.error('push:', (err && (err.statusCode || err.message)) || err);
      }
    }
  }));
}

// El texto del mensaje nunca viaja en la notificación (se ve en la pantalla bloqueada).
async function avisarDocente(docenteId, payload) {
  if (!habilitado) return;
  try {
    const q = await pool.query(
      "SELECT endpoint, p256dh, auth FROM push_subs WHERE rol = 'docente' AND docente_id = $1", [docenteId]);
    await enviar(q.rows, payload);
  } catch (err) { console.error('push docente:', err.message); }
}

async function avisarEstudiantes(dnis, payload) {
  if (!habilitado || !dnis || !dnis.length) return;
  try {
    const q = await pool.query(
      "SELECT endpoint, p256dh, auth FROM push_subs WHERE rol = 'estudiante' AND dni = ANY($1::text[])", [dnis]);
    await enviar(q.rows, payload);
  } catch (err) { console.error('push estudiantes:', err.message); }
}

// Valida lo que manda el navegador al suscribirse.
function suscripcionValida(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && sub.endpoint.length <= 2048 &&
    /^https:\/\//.test(sub.endpoint) && sub.keys &&
    typeof sub.keys.p256dh === 'string' && sub.keys.p256dh.length <= 256 &&
    typeof sub.keys.auth === 'string' && sub.keys.auth.length <= 128);
}

module.exports = {
  habilitado: () => habilitado,
  publicKey: () => (habilitado ? PUBLIC_KEY : ''),
  avisarDocente,
  avisarEstudiantes,
  suscripcionValida
};
