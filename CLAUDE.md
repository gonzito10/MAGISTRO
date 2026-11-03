# MAGISTRO — Instrucciones y contexto del proyecto

Sistema de gestión docente online con portal de estudiantes. Este archivo es la
guía para quien trabaje en el proyecto (persona o Claude). Para pasos de
despliegue detallados ver `README.md`.

## Qué es

- **App del docente** (`public/docente.html`): materias, comisiones, estudiantes,
  notas, asistencia y planificación. Login con mail y contraseña.
- **Portal del estudiante** (`public/portal-estudiante.html`): solo lectura.
  El estudiante entra con su **DNI** (sin cuenta ni contraseña) y ve su
  cronograma, notas y asistencia.
- **Menú principal** (`public/index.html`).
- Multi-docente: cada docente solo ve sus propios datos.

Dueño del proyecto: Gonzalo (cuenta de GitHub `gonzito10`). Idioma de trabajo
y de la interfaz: **español rioplatense** (Argentina).

## Stack

| Parte | Tecnología |
|---|---|
| Front-end | HTML/CSS/JS en archivos únicos, sin framework ni build |
| Backend | Node.js 22 + Express 4, un solo archivo de entrada (`server.js`) |
| Base de datos | PostgreSQL en **Neon** (driver `pg`) |
| Sesión | JWT en cookie `magistro_token` (httpOnly, sameSite lax, secure en producción) |
| Hosting | **Vercel** (Express como una única función serverless; `public/` por CDN) |

## Estructura

```
server.js            App Express. Exporta la app (Vercel); app.listen solo si se corre directo
schema.sql           Tablas (docentes, materias, comisiones, estudiantes_index, app_config)
db/pool.js           Pool de pg (chico, pensado para serverless)
db/migrate.js        npm run migrate: ejecuta schema.sql
middleware/auth.js   JWT + cookie; requireDocente / requireEstudiante
routes/auth.js       Registro/login docente, login estudiante por DNI, /me, /logout
routes/docente.js    GET/PUT /api/docente/state y /config (protegido)
routes/estudiante.js GET /api/estudiante/mis-materias, /data; POST /cambiar
public/              Las tres páginas HTML
public/manifest.webmanifest  Manifest de la PWA (nombre, colores, íconos, accesos directos)
public/sw.js         Service worker: cachea solo estáticos, NUNCA /api/*
public/pwa.js        Registra el service worker (lo cargan las tres páginas)
public/a11y.js       Hace enfocables y activables con teclado los controles hechos con <div onclick>
public/icons/        Íconos 192, 512, maskable y apple-touch (acanto sobre terracota)
```

## Modelo de datos (resumen)

- `docentes`: cuenta del docente (password con bcrypt).
- `materias` y `comisiones`: id generado por el front-end, `data` en JSONB con la
  misma forma que usaba antes `localStorage` (students, attendance, planning, etc.).
- `estudiantes_index (dni, comision_id, student_id, nombre)`: se **reconstruye
  en cada guardado** del docente; permite el login por DNI.
- `app_config`: preferencias de UI por docente.
- El docente guarda **todo su estado de una vez**: `PUT /api/docente/state`
  (transacción: upsert de lo enviado y borrado de lo que ya no está).

## Variables de entorno

- `DATABASE_URL`: connection string de Neon. En Vercel usar la versión
  **pooled** (host con `-pooler`).
- `JWT_SECRET`: texto largo y aleatorio.
- `PG_POOL_MAX` (opcional): conexiones por instancia, por defecto 5.

Plantilla en `.env.example`. **Nunca** subir `.env` ni secretos al repo.

## Cómo correrlo en local

```bash
npm install
cp .env.example .env     # completar DATABASE_URL y JWT_SECRET
npm run migrate          # una sola vez, crea las tablas
npm start                # http://localhost:3000
```

## Despliegue

Vercel conectado al repo `gonzito10/MAGISTRO`: cada push a `main` redespliega.
Vercel detecta Express solo (no hay `vercel.json`). Detalles y límites en el README.

## Reglas y convenciones

- **Seguridad de datos**: un docente nunca debe poder leer ni escribir datos de
  otro (toda consulta filtra por `docente_id`). Un estudiante solo recibe SU fila
  de notas y asistencia, nunca la del resto de la comisión.
- Las llamadas del front usan **rutas relativas** (`/api/...`). No poner URLs
  absolutas.
- En Vercel `express.static()` se ignora: todo estático va en `public/`.
- Manejar errores en Express y responder JSON, no páginas de error por defecto.
- **PWA**: el service worker no debe cachear ni interceptar `/api/*` (datos de
  notas, asistencia y sesión). Páginas con red primero; estáticos y librerías
  externas (fuentes, CDN) desde caché. Si cambiás íconos o archivos estáticos
  y no se ven en un celular que ya la instaló, subí `VERSION` en `sw.js`.
- **Celular** (≤700 px): en `docente.html` la navegación es una barra inferior
  (Inicio, Estudiantes, Notas, Asistencia, Más) y el selector de curso va
  arriba. La hoja "Más" se arma por JS clonando los botones del menú lateral
  (`initMoreSheet`). Elementos táctiles de al menos 44 px (en tablas, 36 px) y
  campos a 16 px para evitar el zoom de iOS. El portal del estudiante usa el mismo
  patrón (barra inferior: Inicio, Notas, Asistencia, Cronograma, Más) y mantiene el
  selector de curso arriba (`buildMoreSheet` arma la hoja).
- **Accesibilidad**: `--text3` (texto secundario) debe mantener contraste ≥ 4,5:1
  sobre el fondo de cada paleta (ya ajustado en las 8 paletas); foco visible global
  con `:focus-visible`; respetar `prefers-reduced-motion`. Los controles nuevos
  hechos con `<div>` deben entrar en el selector de `a11y.js` o ser `<button>`.
- No cambiar el formato JSON de `data` sin migrar los datos existentes.
- Textos de la interfaz y mensajes de error: en español.

## Límites y riesgos conocidos

- Plan Hobby de Vercel: solo **uso no comercial**; hay límites de cuota y de
  tiempo por función (verificar en vercel.com/pricing, cambian seguido).
- El cuerpo de una petición a una función de Vercel tiene tope (~4,5 MB). Un
  estado de docente que lo supere hace fallar el guardado (responde 413). Si
  se acerca, comprimir el JSON o guardar solo los cambios.
- Cualquier persona puede registrarse como docente (autoregistro libre). Si se
  usa en una institución, evaluar código de invitación.
- Los estudiantes entran solo con DNI: no hay recuperación de contraseña porque
  no hay contraseña.
- Tema de color e ícono de la UI quedan en el navegador del docente, no en la
  base (`app_config` existe pero el front no lo usa para eso todavía).

## Estado actual y próximos pasos

- [x] Código movido a la raíz del repo y adaptado a Vercel (app exportada, pool
      serverless, `.gitignore`, `.env.example`).
- [x] Proyecto desplegado en Vercel (https://magistro.vercel.app), registro y login probados.
- [x] **PWA** armada: manifest, íconos, service worker sin caché de `/api`, metas
      (`theme-color`, `apple-touch-icon`, `viewport-fit`), una sola PWA para
      docentes y estudiantes (accesos directos a cada portal).
- [x] Navegación móvil con barra inferior y elementos táctiles de 44 px en `docente.html`.
- [x] Portal del estudiante en celular: barra inferior y selector de curso visible
      (antes estaba oculto en pantallas chicas: un estudiante con dos materias no podía cambiar).
- [x] Revisión en celular de Planificación (filas en dos líneas), Estudiantes, Asistencia,
      Actividades, Bibliografía, Trámites, Archivo y Configuración.
- [x] Contraste del texto secundario, foco visible, `prefers-reduced-motion`, acceso por teclado.
- [x] Bienvenida con avance automático (o toque) y aviso sin conexión en el login del portal.
- [ ] Probar la instalación en un celular real (Android: Chrome → "Instalar app";
      iPhone: Safari → Compartir → "Agregar a inicio").
- [ ] Modo oscuro: ya existe como opción manual en Configuración y en el portal; falta
      que siga la preferencia del sistema y que la bienvenida use el mismo mecanismo.
- [ ] Paleta de colores repetida en las 3 páginas: pasarla a un CSS compartido
      (`public/tokens.css`) y sacar estilos en línea de `docente.html` (≈385).
- [ ] Probar con datos reales las secciones Planificación, Trámites y Archivo (las
      revisé con datos de ejemplo).
- [ ] El texto de los íconos pequeños (≈ 9–11 px en etiquetas) y las tablas densas
      (controles de 36 px) siguen por debajo de lo ideal en celular.
