require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const docenteRoutes = require('./routes/docente');
const estudianteRoutes = require('./routes/estudiante');
const mensajesRoutes = require('./routes/mensajes');

const app = express();

// Los estudiantes solo mandan mensajes cortos: tope chico para sus rutas (va antes del parser general).
app.use('/api/estudiante', express.json({ limit: '20kb' }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// API
app.use('/api', authRoutes);
app.use('/api/docente/mensajes', mensajesRoutes.docente);
app.use('/api/docente', docenteRoutes);
app.use('/api/estudiante', mensajesRoutes.estudiante);
app.use('/api/estudiante', estudianteRoutes);

// Archivos estáticos: menú principal, la app del docente y el portal del estudiante.
// - En local (npm start) los sirve Express desde public/.
// - En Vercel, express.static() se ignora: la carpeta public/ la sirve el CDN de Vercel
//   (public/index.html queda en "/").
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Manejo de errores: evita que Express muestre su página 500 por defecto
// (en Vercel esto impediría reiniciar la función ante un error).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Los datos son demasiado grandes para guardarse.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// Vercel importa este archivo y usa la app exportada.
module.exports = app;

// Solo en local (node server.js / npm start): levantar el servidor en un puerto.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`MAGISTRO backend escuchando en el puerto ${PORT}`);
  });
}
