const express = require('express');
const pool = require('../db/pool');
const { requireEstudiante, setAuthCookie } = require('../middleware/auth');
const { buscarCursosPorDni } = require('./auth');

const router = express.Router();
router.use(requireEstudiante);

// Todos los cursos donde este DNI está matriculado (para el selector "Mis materias").
router.get('/mis-materias', async (req, res) => {
  try {
    const cursos = await buscarCursosPorDni(req.estudiante.dni);
    res.json({
      cursos: cursos.map(r => ({
        comisionId: r.comision_id,
        materia: r.materia_nombre || r.comision_title,
        comision: r.comision_num,
        docente: r.docente_nombre,
        activo: r.comision_id === req.estudiante.comisionId
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tus materias.' });
  }
});

// Cambiar de curso sin volver a escribir el DNI (ya autenticado).
router.post('/cambiar', async (req, res) => {
  try {
    const { comisionId } = req.body || {};
    if (!comisionId) return res.status(400).json({ error: 'Falta el curso a seleccionar.' });
    const q = await pool.query(
      'SELECT student_id FROM estudiantes_index WHERE dni = $1 AND comision_id = $2',
      [req.estudiante.dni, comisionId]
    );
    if (!q.rows.length) return res.status(404).json({ error: 'No estás matriculado en ese curso.' });
    setAuthCookie(res, {
      role: 'estudiante', dni: req.estudiante.dni, comisionId, studentId: q.rows[0].student_id
    }, '12h');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar de curso.' });
  }
});

// Devuelve únicamente lo que le corresponde ver a ESTE estudiante:
// datos de la comisión + cronograma/bibliografía (compartidos), y sus
// propias notas, asistencia y actividades (nunca las de sus compañeros).
router.get('/data', async (req, res) => {
  try {
    const { comisionId, studentId, dni } = req.estudiante;

    const q = await pool.query(
      `SELECT c.data AS com_data, m.nombre AS materia_nombre, m.data AS materia_data, d.nombre AS docente_nombre
       FROM comisiones c
       LEFT JOIN materias m ON m.id = c.materia_id
       JOIN docentes d ON d.id = c.docente_id
       WHERE c.id = $1`,
      [comisionId]
    );
    if (!q.rows.length) return res.status(404).json({ error: 'Curso no encontrado.' });

    const { com_data: com, materia_nombre, materia_data, docente_nombre } = q.rows[0];
    const students = Array.isArray(com.students) ? com.students : [];
    const propioIdx = students.findIndex(s => s.id === studentId);
    const propio = propioIdx >= 0 ? students[propioIdx] : students.find(s => s.dni === dni);
    if (!propio) return res.status(404).json({ error: 'No encontramos tus datos en este curso.' });
    const si = propioIdx >= 0 ? propioIdx : students.findIndex(s => s === propio);

    const att = com.attendance || { dates: [], records: {} };
    const misRegistros = (att.records && att.records[propio.id]) || {};

    // ── Actividades: com.workRecords se guarda con clave `${indice}_${workId}` ──
    const unidades = com.unidades || [];
    const unitWorks = com.unitWorks || {};
    const workRecords = com.workRecords || {};
    const misTrabajos = {};
    unidades.forEach(u => {
      const works = unitWorks[u.id] || [];
      if (!works.length) return;
      misTrabajos[u.id] = {
        unidad: { id: u.id, numero: u.numero, nombre: u.nombre },
        trabajos: works.map(w => {
          const r = workRecords[`${si}_${w.id}`] || { entregado: '', concepto: '' };
          return { id: w.id, name: w.name, entregado: r.entregado || '', concepto: r.concepto || '' };
        })
      };
    });

    res.json({
      estudiante: { nombre: propio.name || '', dni: propio.dni || dni },
      curso: {
        materia: materia_nombre || com.title || '',
        docente: docente_nombre || '',
        comision: com.comision || '',
        horario: com.horario || '',
        aula: com.aula || '',
        periodo: com.periodo || ''
      },
      notas: {
        p1: propio.p1 ?? '',
        p2: propio.p2 ?? '',
        rec: propio.rec ?? '',
        comentarios: propio.comentarios || {}
      },
      cronograma: {
        planning: com.planning || null,
        unidades: com.unidades || []
      },
      asistencia: {
        dates: att.dates || [],
        skipWeeks: com.skipWeeks || {},
        misRegistros
      },
      actividades: misTrabajos,
      biblio: (materia_data && materia_data.biblio) || [],
      materiales: (materia_data && materia_data.materiales) || [],
      tablon: (com.tablon || []).slice().sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar tus datos.' });
  }
});

module.exports = router;

