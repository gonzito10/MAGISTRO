const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'magistro_token';

function signToken(payload, expiresIn) {
  return jwt.sign(payload, SECRET, { expiresIn });
}

function setAuthCookie(res, payload, expiresIn) {
  const token = signToken(payload, expiresIn);
  const maxAgeMs = expiresIn.endsWith('h')
    ? parseInt(expiresIn) * 60 * 60 * 1000
    : expiresIn.endsWith('d')
    ? parseInt(expiresIn) * 24 * 60 * 60 * 1000
    : 12 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeMs
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readSession(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

// Exige que haya un docente logueado. Cuelga req.docenteId.
function requireDocente(req, res, next) {
  const session = readSession(req);
  if (!session || session.role !== 'docente') {
    return res.status(401).json({ error: 'No autenticado como docente.' });
  }
  req.docenteId = session.docenteId;
  next();
}

// Exige que haya un estudiante logueado (ya con comisión elegida). Cuelga req.estudiante.
function requireEstudiante(req, res, next) {
  const session = readSession(req);
  if (!session || session.role !== 'estudiante') {
    return res.status(401).json({ error: 'No autenticado como estudiante.' });
  }
  req.estudiante = {
    dni: session.dni,
    comisionId: session.comisionId,
    studentId: session.studentId
  };
  next();
}

module.exports = {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  readSession,
  requireDocente,
  requireEstudiante,
  COOKIE_NAME
};
