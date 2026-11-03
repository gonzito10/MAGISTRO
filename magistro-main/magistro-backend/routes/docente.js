const express = require('express');
const pool = require('../db/pool');
const { requireDocente } = require('../middleware/auth');

const router = express.Router();
router.use(requireDocente);

// Reconstruye el estado completo tal como lo espera el front-end:
// { materias, commissions, activeId, activeSection }
router.get('/state', async (req, res) => {
  try {
    const docenteId = req.docenteId;
    const [materiasQ, comisionesQ, configQ] = await Promise.all([
      pool.query('SELECT id, nombre, data FROM materias WHERE docente_id = $1', [docenteId]),
      pool.query('SELECT id, materia_id, data FROM comisiones WHERE docente_id = $1', [docenteId]),
      pool.query('SELECT * FROM app_config WHERE docente_id = $1', [docenteId])
    ]);

    const materias = materiasQ.rows.map(r => ({ ...(r.data || {}), id: r.id, nombre: r.nombre }));
    const commissions = comisionesQ.rows.map(r => ({ ...(r.data || {}), id: r.id, materiaId: r.materia_id }));
    const config = configQ.rows[0] || {};

    res.json({
      materias,
      commissions,
      activeId: config.active_id || null,
      activeSection: config.active_section || 'estudiantes',
      activeMateriaId: config.active_materia_id || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar los datos.' });
  }
});

// Guarda TODO el estado de una vez (mismo modelo que usaba localStorage).
router.put('/state', async (req, res) => {
  const client = await pool.connect();
  try {
    const docenteId = req.docenteId;
    const { materias = [], commissions = [], activeId = null, activeSection = 'estudiantes', activeMateriaId = null } = req.body || {};

    await client.query('BEGIN');

    // ── Materias ──
    const materiaIds = materias.map(m => m.id).filter(Boolean);
    for (const m of materias) {
      if (!m.id) continue;
      const { id, nombre, ...rest } = m;
      await client.query(
        `INSERT INTO materias (id, docente_id, nombre, data, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, data = EXCLUDED.data, updated_at = now()
         WHERE materias.docente_id = $2`,
        [id, docenteId, nombre || '', JSON.stringify(rest)]
      );
    }
    if (materiaIds.length) {
      await client.query(
        'DELETE FROM materias WHERE docente_id = $1 AND id <> ALL($2::text[])',
        [docenteId, materiaIds]
      );
    } else {
      await client.query('DELETE FROM materias WHERE docente_id = $1', [docenteId]);
    }

    // ── Comisiones ──
    const comisionIds = commissions.map(c => c.id).filter(Boolean);
    for (const c of commissions) {
      if (!c.id) continue;
      const { id, materiaId, ...rest } = c;
      await client.query(
        `INSERT INTO comisiones (id, docente_id, materia_id, data, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET materia_id = EXCLUDED.materia_id, data = EXCLUDED.data, updated_at = now()
         WHERE comisiones.docente_id = $2`,
        [id, docenteId, materiaId || null, JSON.stringify({ ...rest, id, materiaId })]
      );

      // Reconstruir índice de estudiantes de esta comisión
      await client.query('DELETE FROM estudiantes_index WHERE comision_id = $1', [id]);
      const students = Array.isArray(rest.students) ? rest.students : [];
      for (const s of students) {
        if (!s.dni) continue;
        const dniNorm = String(s.dni).trim().replace(/\D/g, '');
        if (!dniNorm) continue;
        await client.query(
          `INSERT INTO estudiantes_index (dni, comision_id, student_id, nombre)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (dni, comision_id) DO UPDATE SET student_id = EXCLUDED.student_id, nombre = EXCLUDED.nombre`,
          [dniNorm, id, s.id || dniNorm, s.name || '']
        );
      }
    }
    if (comisionIds.length) {
      await client.query(
        'DELETE FROM comisiones WHERE docente_id = $1 AND id <> ALL($2::text[])',
        [docenteId, comisionIds]
      );
    } else {
      await client.query('DELETE FROM comisiones WHERE docente_id = $1', [docenteId]);
    }

    // ── Config / puntero de navegación ──
    await client.query(
      `INSERT INTO app_config (docente_id, active_materia_id, active_id, active_section)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (docente_id) DO UPDATE SET
         active_materia_id = EXCLUDED.active_materia_id,
         active_id = EXCLUDED.active_id,
         active_section = EXCLUDED.active_section`,
      [docenteId, activeMateriaId, activeId, activeSection]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al guardar los datos.' });
  } finally {
    client.release();
  }
});

// Tema / ícono de la interfaz (preferencia liviana, no crítica)
router.get('/config', async (req, res) => {
  const q = await pool.query('SELECT theme, icon FROM app_config WHERE docente_id = $1', [req.docenteId]);
  res.json(q.rows[0] || { theme: null, icon: null });
});

router.put('/config', async (req, res) => {
  const { theme, icon } = req.body || {};
  await pool.query(
    `INSERT INTO app_config (docente_id, theme, icon) VALUES ($1,$2,$3)
     ON CONFLICT (docente_id) DO UPDATE SET theme = EXCLUDED.theme, icon = EXCLUDED.icon`,
    [req.docenteId, theme || null, icon || null]
  );
  res.json({ ok: true });
});

module.exports = router;
