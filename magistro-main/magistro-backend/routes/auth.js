const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { setAuthCookie, clearAuthCookie, readSession } = require('../middleware/auth');

const router = express.Router();

// Reutilizado por /estudiante/login y por /estudiante/mis-materias (ya logueado)
async function buscarCursosPorDni(dniNorm) {
  const q = await pool.query(
    `SELECT ei.comision_id, ei.student_id, ei.nombre AS est_nombre,
            c.data->>'title' AS comision_title, c.data->>'comision' AS comision_num,
            m.nombre AS materia_nombre, d.nombre AS docente_nombre
     FROM estudiantes_index ei
     JOIN comisiones c ON c.id = ei.comision_id
     LEFT JOIN materias m ON m.id = c.materia_id
     JOIN docentes d ON d.id = c.docente_id
     WHERE ei.dni = $1 AND (c.data->>'archived')::boolean IS NOT TRUE
     ORDER BY m.nombre, c.data->>'comision'`,
    [dniNorm]
  );
  return q.rows;
}

// ── Docente: registro ──────────────────────────────────────────
router.post('/docente/register', async (req, res) => {
  try {
    const { nombre, email, password } = req.body || {};
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Faltan datos (nombre, email, password).' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM docentes WHERE email = $1', [emailNorm]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO docentes (nombre, email, password_hash) VALUES ($1,$2,$3) RETURNING id, nombre, email',
      [nombre.trim(), emailNorm, hash]
    );
    const docente = result.rows[0];
    await pool.query('INSERT INTO app_config (docente_id) VALUES ($1) ON CONFLICT DO NOTHING', [docente.id]);
    setAuthCookie(res, { role: 'docente', docenteId: docente.id }, '7d');
    res.json({ ok: true, docente: { id: docente.id, nombre: docente.nombre, email: docente.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar la cuenta.' });
  }
});

// ── Docente: login ──────────────────────────────────────────────
router.post('/docente/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan email o contraseña.' });
    const emailNorm = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT * FROM docentes WHERE email = $1', [emailNorm]);
    const docente = result.rows[0];
    if (!docente) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    const ok = await bcrypt.compare(password, docente.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    setAuthCookie(res, { role: 'docente', docenteId: docente.id }, '7d');
    res.json({ ok: true, docente: { id: docente.id, nombre: docente.nombre, email: docente.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// ── Estudiante: paso 1, buscar DNI ──────────────────────────────
// Si el DNI aparece en una sola comisión, loguea directo.
// Si aparece en varias (múltiples materias/docentes), devuelve la lista
// para que el estudiante elija cuál quiere ver.
router.post('/estudiante/login', async (req, res) => {
  try {
    const { dni } = req.body || {};
    if (!dni) return res.status(400).json({ error: 'Ingresá tu DNI.' });
    const dniNorm = String(dni).trim().replace(/\D/g, '');
    if (!dniNorm) return res.status(400).json({ error: 'DNI inválido.' });

    const q = await buscarCursosPorDni(dniNorm);

    if (!q.length) {
      return res.status(404).json({ error: 'No encontramos ningún curso con ese DNI. Consultá con tu docente.' });
    }

    if (q.length === 1) {
      const row = q[0];
      setAuthCookie(res, {
        role: 'estudiante', dni: dniNorm, comisionId: row.comision_id, studentId: row.student_id
      }, '12h');
      return res.json({ ok: true, seleccionado: true, nombre: row.est_nombre });
    }

    // Varias coincidencias: el front-end debe llamar a /estudiante/elegir con el comision_id
    res.json({
      ok: true,
      seleccionado: false,
      dni: dniNorm,
      opciones: q.map(r => ({
        comisionId: r.comision_id,
        materia: r.materia_nombre || r.comision_title,
        comision: r.comision_num,
        docente: r.docente_nombre
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar el DNI.' });
  }
});

// ── Estudiante: paso 2 (solo si había más de una coincidencia) ──
router.post('/estudiante/elegir', async (req, res) => {
  try {
    const { dni, comisionId } = req.body || {};
    const dniNorm = String(dni || '').trim().replace(/\D/g, '');
    if (!dniNorm || !comisionId) return res.status(400).json({ error: 'Faltan datos.' });
    const q = await pool.query(
      'SELECT student_id FROM estudiantes_index WHERE dni = $1 AND comision_id = $2',
      [dniNorm, comisionId]
    );
    if (!q.rows.length) return res.status(404).json({ error: 'No encontramos esa combinación de DNI y curso.' });
    setAuthCookie(res, {
      role: 'estudiante', dni: dniNorm, comisionId, studentId: q.rows[0].student_id
    }, '12h');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al seleccionar el curso.' });
  }
});

// ── Sesión actual (para saber si mostrar login o la app) ────────
router.get('/me', async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'No autenticado.' });
  if (session.role === 'docente') {
    const q = await pool.query('SELECT id, nombre, email FROM docentes WHERE id = $1', [session.docenteId]);
    if (!q.rows.length) return res.status(401).json({ error: 'No autenticado.' });
    return res.json({ role: 'docente', docente: q.rows[0] });
  }
  if (session.role === 'estudiante') {
    return res.json({ role: 'estudiante', dni: session.dni, comisionId: session.comisionId });
  }
  res.status(401).json({ error: 'No autenticado.' });
});

// ── Cerrar sesión ────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

module.exports = router;
module.exports.buscarCursosPorDni = buscarCursosPorDni;
