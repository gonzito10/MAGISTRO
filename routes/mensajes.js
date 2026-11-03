// Mensajes privados docente–estudiante, posteos y comentarios del tablón, y suscripción a avisos push.
// Reglas:
//  - Un docente solo toca comisiones que son suyas (se verifica con docente_id en cada consulta).
//  - Un estudiante solo opera en la comisión de su sesión y solo ve SU conversación privada.
//  - El texto del mensaje nunca va dentro de la notificación push.
const express = require('express');
const pool = require('../db/pool');
const push = require('../lib/push');
const { requireDocente, requireEstudiante } = require('../middleware/auth');

const MAX_TEXTO = 1000;
const PARENT_RE = /^(aviso|post):[A-Za-z0-9_.\-]{1,80}$/;
const LIMITE_POR_MINUTO = 5;
const LIMITE_POR_DIA = 60;

function leerTexto(body) {
  const t = String(body && body.texto != null ? body.texto : '').replace(/\r\n/g, '\n').trim();
  if (!t) return { error: 'Escribí un mensaje.' };
  if (t.length > MAX_TEXTO) return { error: `El mensaje es muy largo (máximo ${MAX_TEXTO} caracteres).` };
  return { texto: t };
}

function leerId(valor) {
  const s = String(valor == null ? '' : valor);
  return /^\d{1,15}$/.test(s) ? s : null;
}

function leerComisionId(valor) {
  const s = String(valor == null ? '' : valor).trim();
  return s && s.length <= 100 ? s : null;
}

async function infoComision(comisionId) {
  const q = await pool.query(
    `SELECT c.docente_id, COALESCE(m.nombre, c.data->>'title', 'tu curso') AS materia
     FROM comisiones c LEFT JOIN materias m ON m.id = c.materia_id
     WHERE c.id = $1`, [comisionId]);
  return q.rows[0] || null;
}

// 'aviso:<id>' (aviso del docente, vive en comisiones.data) o 'post:<id>' (posteo de un estudiante).
async function validarParent(comisionId, parent) {
  if (!PARENT_RE.test(parent || '')) return null;
  const i = parent.indexOf(':');
  const tipo = parent.slice(0, i), id = parent.slice(i + 1);
  if (tipo === 'aviso') {
    const q = await pool.query(
      `SELECT 1
       FROM comisiones c,
            jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'tablon') = 'array' THEN c.data->'tablon' ELSE '[]'::jsonb END) p
       WHERE c.id = $1 AND p->>'id' = $2 LIMIT 1`, [comisionId, id]);
    return q.rows.length ? { tipo, id, studentId: null } : null;
  }
  if (!/^\d{1,15}$/.test(id)) return null;
  const q = await pool.query(
    "SELECT student_id FROM mensajes WHERE id = $1 AND comision_id = $2 AND tipo = 'tablon'", [id, comisionId]);
  return q.rows.length ? { tipo, id, studentId: q.rows[0].student_id } : null;
}

const fila = r => ({
  id: String(r.id),
  autor: r.autor,
  autorNombre: r.autor_nombre,
  parent: r.parent_id || null,
  texto: r.texto,
  fecha: r.created_at
});

// ════════════════════════════════════════════════════════════
// ESTUDIANTE
// ════════════════════════════════════════════════════════════
const estudiante = express.Router();
estudiante.use(requireEstudiante);

// Fila vigente del estudiante en su comisión (si ya no está matriculado, no puede escribir).
async function miFila(req) {
  const q = await pool.query(
    'SELECT student_id, nombre FROM estudiantes_index WHERE dni = $1 AND comision_id = $2',
    [req.estudiante.dni, req.estudiante.comisionId]);
  return q.rows[0] || null;
}

async function superaLimite(comisionId, studentId) {
  const q = await pool.query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute') AS minuto, count(*) AS dia
     FROM mensajes_cuota
     WHERE comision_id = $1 AND student_id = $2 AND created_at > now() - interval '1 day'`,
    [comisionId, studentId]);
  return parseInt(q.rows[0].minuto, 10) >= LIMITE_POR_MINUTO || parseInt(q.rows[0].dia, 10) >= LIMITE_POR_DIA;
}

// Anota el envío en la cuota y limpia lo viejo (más de un día).
async function anotarEnvio(comisionId, studentId) {
  await pool.query('INSERT INTO mensajes_cuota (comision_id, student_id) VALUES ($1,$2)', [comisionId, studentId]);
  await pool.query("DELETE FROM mensajes_cuota WHERE created_at < now() - interval '1 day'");
}

async function dnisCompaneros(comisionId, dniPropio) {
  const q = await pool.query('SELECT dni FROM estudiantes_index WHERE comision_id = $1 AND dni <> $2', [comisionId, dniPropio]);
  return q.rows.map(r => r.dni);
}

// Mi conversación privada + posteos y comentarios del tablón de mi comisión.
estudiante.get('/mensajes', async (req, res) => {
  try {
    const { comisionId } = req.estudiante;
    const yo = await miFila(req);
    if (!yo) return res.status(404).json({ error: 'No encontramos tus datos en este curso.' });
    const [priv, pub] = await Promise.all([
      pool.query(
        `SELECT id, autor, autor_nombre, parent_id, texto, created_at FROM mensajes
         WHERE comision_id = $1 AND tipo = 'privado' AND student_id = $2
         ORDER BY created_at ASC, id ASC LIMIT 300`, [comisionId, yo.student_id]),
      pool.query(
        `SELECT id, tipo, autor, autor_nombre, parent_id, texto, created_at,
                (autor = 'estudiante' AND student_id = $2) AS propio
         FROM mensajes
         WHERE comision_id = $1 AND tipo IN ('tablon','comentario')
         ORDER BY created_at ASC, id ASC LIMIT 500`, [comisionId, yo.student_id])
    ]);
    res.json({
      privados: priv.rows.map(fila),
      tablon: pub.rows.filter(r => r.tipo === 'tablon').map(r => ({ ...fila(r), propio: r.propio })),
      comentarios: pub.rows.filter(r => r.tipo === 'comentario').map(r => ({ ...fila(r), propio: r.propio }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar los mensajes.' });
  }
});

// Alta común de privado / posteo / comentario.
async function crear(req, res, tipo, extra) {
  try {
    const { comisionId } = req.estudiante;
    const t = leerTexto(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const yo = await miFila(req);
    if (!yo) return res.status(404).json({ error: 'No encontramos tus datos en este curso.' });
    if (await superaLimite(comisionId, yo.student_id)) {
      return res.status(429).json({ error: 'Estás enviando muchos mensajes. Esperá un momento e intentá de nuevo.' });
    }
    let parentId = null;
    if (tipo === 'comentario') {
      const p = await validarParent(comisionId, req.body && req.body.parent);
      if (!p) return res.status(400).json({ error: 'No encontramos el aviso que querés comentar.' });
      parentId = `${p.tipo}:${p.id}`;
    }
    const ins = await pool.query(
      `INSERT INTO mensajes (comision_id, tipo, student_id, autor, autor_nombre, parent_id, texto)
       VALUES ($1,$2,$3,'estudiante',$4,$5,$6) RETURNING id, autor, autor_nombre, parent_id, texto, created_at`,
      [comisionId, tipo, yo.student_id, yo.nombre || '', parentId, t.texto]);

    await anotarEnvio(comisionId, yo.student_id);

    // Avisos push (sin el texto del mensaje).
    const info = await infoComision(comisionId);
    if (info) {
      const url = '/docente.html#mensajes';
      if (tipo === 'privado') {
        await push.avisarDocente(info.docente_id, { title: 'MAGISTRO', body: `Mensaje nuevo en ${info.materia}`, url, tag: 'msg-' + comisionId });
      } else if (tipo === 'tablon') {
        await push.avisarDocente(info.docente_id, { title: 'MAGISTRO', body: `Posteo nuevo en el tablón de ${info.materia}`, url: '/docente.html', tag: 'tablon-' + comisionId });
        const dnis = await dnisCompaneros(comisionId, req.estudiante.dni);
        await push.avisarEstudiantes(dnis, { title: 'MAGISTRO', body: `Posteo nuevo en el tablón de ${info.materia}`, url: '/portal-estudiante.html', tag: 'tablon-' + comisionId });
      } else {
        await push.avisarDocente(info.docente_id, { title: 'MAGISTRO', body: `Comentario nuevo en el tablón de ${info.materia}`, url: '/docente.html', tag: 'tablon-' + comisionId });
      }
    }
    res.json({ ok: true, mensaje: { ...fila(ins.rows[0]), propio: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
  }
}
estudiante.post('/mensajes', (req, res) => crear(req, res, 'privado'));
estudiante.post('/tablon', (req, res) => crear(req, res, 'tablon'));
estudiante.post('/comentarios', (req, res) => crear(req, res, 'comentario'));

// Borrar un posteo o comentario PROPIO (los privados no se borran).
estudiante.delete('/mensajes/:id', async (req, res) => {
  try {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Mensaje inválido.' });
    const { comisionId } = req.estudiante;
    const yo = await miFila(req);
    if (!yo) return res.status(404).json({ error: 'No encontramos tus datos en este curso.' });
    const del = await pool.query(
      `DELETE FROM mensajes
       WHERE id = $1 AND comision_id = $2 AND student_id = $3 AND autor = 'estudiante' AND tipo IN ('tablon','comentario')
       RETURNING id, tipo`, [id, comisionId, yo.student_id]);
    if (!del.rows.length) return res.status(404).json({ error: 'No podés borrar ese mensaje.' });
    if (del.rows[0].tipo === 'tablon') {
      await pool.query("DELETE FROM mensajes WHERE comision_id = $1 AND tipo = 'comentario' AND parent_id = $2", [comisionId, 'post:' + id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el mensaje.' });
  }
});

// ── Avisos push (estudiante) ──
estudiante.get('/push/config', (req, res) => res.json({ habilitado: push.habilitado(), publicKey: push.publicKey() }));

estudiante.post('/push/subscribe', async (req, res) => {
  try {
    if (!push.habilitado()) return res.status(503).json({ error: 'Los avisos al celular todavía no están configurados.' });
    const sub = req.body && req.body.subscription;
    if (!push.suscripcionValida(sub)) return res.status(400).json({ error: 'Suscripción inválida.' });
    await pool.query(
      `INSERT INTO push_subs (endpoint, p256dh, auth, rol, docente_id, dni)
       VALUES ($1,$2,$3,'estudiante',NULL,$4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         rol = 'estudiante', docente_id = NULL, dni = EXCLUDED.dni`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth, req.estudiante.dni]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron activar los avisos.' });
  }
});

estudiante.post('/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Falta el dispositivo.' });
    await pool.query("DELETE FROM push_subs WHERE endpoint = $1 AND rol = 'estudiante' AND dni = $2", [endpoint, req.estudiante.dni]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron desactivar los avisos.' });
  }
});

// ════════════════════════════════════════════════════════════
// DOCENTE
// ════════════════════════════════════════════════════════════
const docente = express.Router();
docente.use(requireDocente);

// Devuelve la comisión solo si es de este docente.
async function comisionPropia(comisionId, docenteId) {
  if (!comisionId) return null;
  const q = await pool.query(
    `SELECT c.id, COALESCE(m.nombre, c.data->>'title', 'tu curso') AS materia
     FROM comisiones c LEFT JOIN materias m ON m.id = c.materia_id
     WHERE c.id = $1 AND c.docente_id = $2`, [comisionId, docenteId]);
  return q.rows[0] || null;
}

async function nombreDocente(docenteId) {
  const q = await pool.query('SELECT nombre FROM docentes WHERE id = $1', [docenteId]);
  return (q.rows[0] && q.rows[0].nombre) || 'Docente';
}

// Conversaciones privadas de una comisión (una por estudiante que escribió), la más reciente primero.
docente.get('/conversaciones', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.query.comisionId);
    if (!(await comisionPropia(comisionId, req.docenteId))) return res.status(404).json({ error: 'Curso no encontrado.' });
    const q = await pool.query(
      `SELECT DISTINCT ON (m.student_id) m.student_id, m.autor, m.texto, m.created_at,
              (SELECT ei.nombre FROM estudiantes_index ei WHERE ei.comision_id = m.comision_id AND ei.student_id = m.student_id LIMIT 1) AS nombre
       FROM mensajes m
       WHERE m.comision_id = $1 AND m.tipo = 'privado'
       ORDER BY m.student_id, m.created_at DESC, m.id DESC`, [comisionId]);
    const lista = q.rows
      .map(r => ({ studentId: r.student_id, nombre: r.nombre || 'Estudiante', ultimoAutor: r.autor, ultimoTexto: r.texto, fecha: r.created_at }))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ conversaciones: lista });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar las conversaciones.' });
  }
});

docente.get('/conversacion', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.query.comisionId);
    const studentId = String(req.query.studentId || '').slice(0, 100);
    if (!studentId || !(await comisionPropia(comisionId, req.docenteId))) return res.status(404).json({ error: 'Conversación no encontrada.' });
    const q = await pool.query(
      `SELECT id, autor, autor_nombre, parent_id, texto, created_at FROM mensajes
       WHERE comision_id = $1 AND tipo = 'privado' AND student_id = $2
       ORDER BY created_at ASC, id ASC LIMIT 300`, [comisionId, studentId]);
    res.json({ mensajes: q.rows.map(fila) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar la conversación.' });
  }
});

// El docente escribe a un estudiante (puede iniciar la conversación).
docente.post('/conversacion', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.body && req.body.comisionId);
    const studentId = String((req.body && req.body.studentId) || '').slice(0, 100);
    const t = leerTexto(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const com = await comisionPropia(comisionId, req.docenteId);
    if (!com || !studentId) return res.status(404).json({ error: 'Curso o estudiante no encontrado.' });
    const est = await pool.query('SELECT dni FROM estudiantes_index WHERE comision_id = $1 AND student_id = $2 LIMIT 1', [comisionId, studentId]);
    if (!est.rows.length) return res.status(404).json({ error: 'Ese estudiante no está en el curso.' });
    const ins = await pool.query(
      `INSERT INTO mensajes (comision_id, tipo, student_id, autor, autor_nombre, texto)
       VALUES ($1,'privado',$2,'docente',$3,$4) RETURNING id, autor, autor_nombre, parent_id, texto, created_at`,
      [comisionId, studentId, await nombreDocente(req.docenteId), t.texto]);
    await push.avisarEstudiantes([est.rows[0].dni], { title: 'MAGISTRO', body: `Tenés un mensaje nuevo de tu docente en ${com.materia}`, url: '/portal-estudiante.html#mensajes', tag: 'msg-' + comisionId });
    res.json({ ok: true, mensaje: fila(ins.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
  }
});

// Posteos y comentarios de estudiantes (y comentarios del docente) para moderar desde Inicio.
docente.get('/tablon', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.query.comisionId);
    if (!(await comisionPropia(comisionId, req.docenteId))) return res.status(404).json({ error: 'Curso no encontrado.' });
    const q = await pool.query(
      `SELECT id, tipo, autor, autor_nombre, parent_id, texto, created_at FROM mensajes
       WHERE comision_id = $1 AND tipo IN ('tablon','comentario')
       ORDER BY created_at ASC, id ASC LIMIT 500`, [comisionId]);
    res.json({
      posts: q.rows.filter(r => r.tipo === 'tablon').map(fila),
      comentarios: q.rows.filter(r => r.tipo === 'comentario').map(fila)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar el tablón.' });
  }
});

// El docente comenta un aviso o un posteo.
docente.post('/comentario', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.body && req.body.comisionId);
    const t = leerTexto(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const com = await comisionPropia(comisionId, req.docenteId);
    if (!com) return res.status(404).json({ error: 'Curso no encontrado.' });
    const p = await validarParent(comisionId, req.body && req.body.parent);
    if (!p) return res.status(400).json({ error: 'No encontramos el aviso que querés comentar.' });
    const ins = await pool.query(
      `INSERT INTO mensajes (comision_id, tipo, student_id, autor, autor_nombre, parent_id, texto)
       VALUES ($1,'comentario',NULL,'docente',$2,$3,$4) RETURNING id, autor, autor_nombre, parent_id, texto, created_at`,
      [comisionId, await nombreDocente(req.docenteId), `${p.tipo}:${p.id}`, t.texto]);
    // Si comentó el posteo de un estudiante, se le avisa solo a esa persona.
    if (p.tipo === 'post' && p.studentId) {
      const est = await pool.query('SELECT dni FROM estudiantes_index WHERE comision_id = $1 AND student_id = $2 LIMIT 1', [comisionId, p.studentId]);
      if (est.rows.length) {
        await push.avisarEstudiantes([est.rows[0].dni], { title: 'MAGISTRO', body: `Tu docente comentó tu posteo en ${com.materia}`, url: '/portal-estudiante.html', tag: 'tablon-' + comisionId });
      }
    }
    res.json({ ok: true, mensaje: fila(ins.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo publicar el comentario.' });
  }
});

// Moderación: borrar un posteo o comentario (de cualquier autor) de una comisión propia.
docente.delete('/mensaje/:id', async (req, res) => {
  try {
    const id = leerId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Mensaje inválido.' });
    const del = await pool.query(
      `DELETE FROM mensajes
       WHERE id = $1 AND tipo IN ('tablon','comentario')
         AND comision_id IN (SELECT id FROM comisiones WHERE docente_id = $2)
       RETURNING comision_id, tipo`, [id, req.docenteId]);
    if (!del.rows.length) return res.status(404).json({ error: 'Mensaje no encontrado.' });
    if (del.rows[0].tipo === 'tablon') {
      await pool.query("DELETE FROM mensajes WHERE comision_id = $1 AND tipo = 'comentario' AND parent_id = $2", [del.rows[0].comision_id, 'post:' + id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el mensaje.' });
  }
});

// El front llama a esto después de guardar un aviso nuevo del docente: avisa a todos los estudiantes del curso.
docente.post('/aviso-publicado', async (req, res) => {
  try {
    const comisionId = leerComisionId(req.body && req.body.comisionId);
    const com = await comisionPropia(comisionId, req.docenteId);
    if (!com) return res.status(404).json({ error: 'Curso no encontrado.' });
    const q = await pool.query('SELECT dni FROM estudiantes_index WHERE comision_id = $1', [comisionId]);
    await push.avisarEstudiantes(q.rows.map(r => r.dni), { title: 'MAGISTRO', body: `Aviso nuevo de tu docente en ${com.materia}`, url: '/portal-estudiante.html', tag: 'tablon-' + comisionId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron enviar los avisos.' });
  }
});

// ── Avisos push (docente) ──
docente.get('/push/config', (req, res) => res.json({ habilitado: push.habilitado(), publicKey: push.publicKey() }));

docente.post('/push/subscribe', async (req, res) => {
  try {
    if (!push.habilitado()) return res.status(503).json({ error: 'Los avisos al celular todavía no están configurados.' });
    const sub = req.body && req.body.subscription;
    if (!push.suscripcionValida(sub)) return res.status(400).json({ error: 'Suscripción inválida.' });
    await pool.query(
      `INSERT INTO push_subs (endpoint, p256dh, auth, rol, docente_id, dni)
       VALUES ($1,$2,$3,'docente',$4,NULL)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         rol = 'docente', docente_id = EXCLUDED.docente_id, dni = NULL`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth, req.docenteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron activar los avisos.' });
  }
});

docente.post('/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Falta el dispositivo.' });
    await pool.query("DELETE FROM push_subs WHERE endpoint = $1 AND rol = 'docente' AND docente_id = $2", [endpoint, req.docenteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron desactivar los avisos.' });
  }
});

module.exports = { estudiante, docente };
