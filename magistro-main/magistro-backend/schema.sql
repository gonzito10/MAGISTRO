-- ═══════════════════════════════════════════════════════════════
-- MAGISTRO — Esquema SQL (PostgreSQL / Neon)
-- ═══════════════════════════════════════════════════════════════
-- Diseño: se mantiene la forma de los datos que ya usa el front-end
-- (materias / comisiones con su JSON interno de estudiantes, notas,
-- asistencia y planificación) pero organizado en tablas reales,
-- con multi-tenant por docente y una tabla índice para el login
-- de estudiantes por DNI.

CREATE TABLE IF NOT EXISTS docentes (
  id            SERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materias (
  id           TEXT PRIMARY KEY,               -- id generado por el front-end (ej: 'mat_...')
  docente_id   INTEGER NOT NULL REFERENCES docentes(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- bibliografía, unidades, etc.
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materias_docente ON materias(docente_id);

CREATE TABLE IF NOT EXISTS comisiones (
  id           TEXT PRIMARY KEY,               -- id generado por el front-end
  docente_id   INTEGER NOT NULL REFERENCES docentes(id) ON DELETE CASCADE,
  materia_id   TEXT REFERENCES materias(id) ON DELETE CASCADE,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- data incluye: title, sub, comision, horario, aula, periodo, tabLabel,
  -- students[], attendance{}, planning{}, unitWorks, workRecords,
  -- skipWeeks, archived, anio, cuatrimestre
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comisiones_docente ON comisiones(docente_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_materia ON comisiones(materia_id);

-- Índice de estudiantes: se reconstruye cada vez que un docente guarda
-- su estado. Permite el login de estudiantes por DNI sin exponer nada
-- del resto de la comisión.
CREATE TABLE IF NOT EXISTS estudiantes_index (
  dni          TEXT NOT NULL,
  comision_id  TEXT NOT NULL REFERENCES comisiones(id) ON DELETE CASCADE,
  student_id   TEXT NOT NULL,   -- id local dentro de comision.data.students[]
  nombre       TEXT,
  PRIMARY KEY (dni, comision_id)
);
CREATE INDEX IF NOT EXISTS idx_estudiantes_dni ON estudiantes_index(dni);

-- Preferencias de UI por docente (tema, ícono, última sección abierta)
CREATE TABLE IF NOT EXISTS app_config (
  docente_id        INTEGER PRIMARY KEY REFERENCES docentes(id) ON DELETE CASCADE,
  theme             TEXT,
  icon              TEXT,
  active_materia_id TEXT,
  active_id         TEXT,
  active_section    TEXT
);
