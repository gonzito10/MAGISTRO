# MAGISTRO — Gestión Docente online + Portal de Estudiantes

Este proyecto convierte tu sistema (que antes guardaba todo en el navegador con
`localStorage`) en una aplicación online real:

- **Base de datos**: PostgreSQL (tablas SQL reales — ver `schema.sql`)
- **Backend**: Node.js + Express, con login por cookie de sesión
- **`public/docente.html`**: tu app original, ahora con login (mail + contraseña) y guardado automático en la base de datos
- **`public/portal-estudiante.html`**: portal nuevo, de solo lectura, donde los estudiantes entran con su DNI y consultan cronograma, notas y asistencia

Es multi-docente: cada docente tiene su cuenta y solo ve sus propias materias
y comisiones. Los estudiantes no necesitan cuenta ni contraseña — solo su DNI.

Probé todo el flujo (registro, guardado, login por DNI, selector de curso
cuando el mismo DNI está en dos comisiones, y que ningún docente pueda ver
datos de otro) antes de entregártelo.

---

## 1. Crear la base de datos (Neon — gratis, no se borra con el tiempo)

1. Andá a **https://neon.tech** y creá una cuenta gratuita.
2. Creá un proyecto nuevo (cualquier nombre, por ejemplo `magistro`).
3. En el dashboard del proyecto, copiá el **Connection string** (empieza con
   `postgresql://...`). Lo vas a necesitar en el paso 3.

## 2. Subir el código a GitHub

El código va en la **raíz** del repositorio (`server.js`, `package.json`,
`public/`, etc. directamente en la primera pantalla del repo, no dentro de
otra carpeta). **No subas** `node_modules` ni `.env` (ya están en `.gitignore`).

## 3. Desplegar en Vercel (gratis)

1. Andá a **https://vercel.com** y entrá con tu cuenta de GitHub.
2. Click en **Add New → Project** y elegí el repositorio de MAGISTRO.
3. Vercel detecta Express solo. No hace falta configurar Build ni Start
   Command: dejá todo por defecto (Framework: Express / Other).
4. Abrí **Environment Variables** y agregá:
   - `DATABASE_URL` → el connection string de Neon. Usá la versión
     **pooled** (en Neon, activá "Connection pooling": el host trae
     `-pooler`).
   - `JWT_SECRET` → un texto largo y aleatorio
     (https://randomkeygen.com, una clave larga).
5. Click en **Deploy**. Al terminar te da una URL pública, algo como
   `https://magistro.vercel.app`. Cada `git push` a `main` redespliega solo.

Cómo funciona en Vercel:

- Los archivos de `public/` (`index.html`, `docente.html`,
  `portal-estudiante.html`) los sirve el CDN de Vercel. `express.static()` no
  se usa allí.
- Todo `/api/*` lo atiende `server.js` como una única función serverless.
- `NODE_ENV` ya es `production` en Vercel, así que las cookies de sesión salen
  con `secure`.

Límites a tener en cuenta (verificar siempre en vercel.com/pricing y
vercel.com/docs/limits, cambian seguido):

- El plan **Hobby** es solo para uso personal y no comercial.
- Las funciones tienen un tope de tamaño del cuerpo de la petición (~4,5 MB).
  El docente guarda todo su estado en un solo `PUT /api/docente/state`; si
  algún día un estado supera ese tamaño, el guardado falla con un aviso
  claro (error 413).
- Hay un tiempo máximo por ejecución de la función en Hobby.

## 4. Crear las tablas en la base de datos

Una sola vez, tenés que ejecutar `schema.sql` contra tu base de Neon. La
forma más simple:

1. En el dashboard de Neon, abrí la pestaña **SQL Editor**.
2. Abrí el archivo `schema.sql` de este paquete, copiá todo su contenido y
   pegalo en el editor de Neon.
3. Ejecutalo (botón Run). Esto crea todas las tablas necesarias.

(Alternativa para quien prefiera la terminal: con Node instalado localmente,
copiá `.env.example` a `.env`, completá `DATABASE_URL` con el string de Neon,
y corré `npm install` seguido de `npm run migrate`.)

## 5. ¡Listo! Usar el sistema

- **Docentes**: entrá a `https://tu-app.vercel.app/docente.html`, hacé clic
  en "Registrate" la primera vez, y a partir de ahí "Ingresar" con mail y
  contraseña. Todo lo que cargues se guarda automáticamente en la base de
  datos (ya no depende del navegador ni del dispositivo).
- **Estudiantes**: entrá a `https://tu-app.vercel.app/portal-estudiante.html`
  e ingresá tu número de DNI. Vas a ver el cronograma, tus notas y tu
  asistencia de cada curso donde estés cargado (nunca la de tus compañeros).

> **Nota**: los datos nunca se pierden por cambiar de plataforma: viven en
> Neon, que es aparte del hosting.

---

## Estructura del proyecto

```
magistro/   (raíz del repositorio)
├── schema.sql              ← tablas SQL (Postgres)
├── server.js                ← servidor Express (exporta la app para Vercel)
├── package.json
├── .env.example              ← plantilla de variables de entorno
├── .gitignore
├── db/
│   ├── pool.js               ← conexión a la base de datos
│   └── migrate.js            ← script para crear las tablas
├── middleware/
│   └── auth.js               ← login/sesión (cookies + JWT)
├── routes/
│   ├── auth.js               ← registro/login de docente y DNI de estudiante
│   ├── docente.js             ← guardar/leer todos los datos (protegido)
│   └── estudiante.js          ← consultar datos propios (solo lectura)
└── public/
    ├── index.html              ← menú principal
    ├── docente.html            ← tu app, con login agregado
    └── portal-estudiante.html  ← portal nuevo de estudiantes
```

## Cómo funciona el modelo de datos (resumen)

- Cada **docente** tiene su cuenta (mail + contraseña con hash bcrypt).
- Sus **materias** y **comisiones** quedan asociadas a su cuenta — un docente
  nunca puede ver ni tocar datos de otro.
- Dentro de cada comisión, los datos de estudiantes/notas/asistencia/
  planificación se guardan tal cual los arma tu app (mismo formato que ya
  usabas), pero ahora en una columna de la tabla `comisiones` en vez de en
  `localStorage`.
- Hay una tabla aparte, `estudiantes_index`, que solo guarda "este DNI está
  en esta comisión" — se reconstruye automáticamente cada vez que el docente
  guarda cambios. Es lo que le permite al portal de estudiantes encontrar
  a alguien por su DNI sin tener que crearle una cuenta ni contraseña.
- Cuando un estudiante entra con su DNI, el servidor solo le devuelve SU
  propia fila de notas y SUS propios registros de asistencia — el resto de
  la comisión nunca sale del servidor hacia ese estudiante.

## Cosas para tener en cuenta / posibles próximos pasos

- El tema de color y el ícono de la app (personalización visual) quedaron
  guardados en el navegador de cada docente, no en la base de datos — es
  cosmético y no crítico, pero si querés que también viaje entre
  dispositivos, se puede mover fácil a `app_config`.
- Ahora mismo cualquier persona puede registrarse como docente. Si vas a
  usar esto en una institución y querés controlar quién puede crear cuenta
  (en vez de autoregistro libre), decime y lo ajustamos (por ejemplo, con
  un código de invitación).
- Los DNIs se guardan tal cual los cargue el docente en la planilla de
  estudiantes — no hay forma de "resetear contraseña" porque los estudiantes
  no tienen contraseña, entran directo con el DNI.
