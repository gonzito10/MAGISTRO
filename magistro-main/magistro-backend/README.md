# MAGISTRO — Gestión Docente online + Portal de Estudiantes

Este paquete convierte tu sistema (que antes guardaba todo en el navegador con
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

1. Creá un repositorio nuevo en GitHub (puede ser privado).
2. Subí **toda esta carpeta** (`magistro-backend`) a ese repositorio.
   - Si no sabés usar git desde la terminal, en github.com podés arrastrar
     los archivos directamente con "Add file → Upload files".
   - **No subas** la carpeta `node_modules` ni el archivo `.env` si lo llegás
     a crear localmente (ya están listados en `.gitignore`).

## 3. Desplegar el backend en Render (gratis)

1. Andá a **https://render.com** y creá una cuenta (podés entrar con GitHub).
2. Click en **New → Web Service**.
3. Elegí el repositorio que subiste.
4. Configurá:
   - **Name**: `magistro` (o lo que quieras)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. En la sección **Environment Variables**, agregá:
   - `DATABASE_URL` → pegá el connection string de Neon (paso 1)
   - `JWT_SECRET` → cualquier texto largo y aleatorio (podés generarlo en
     https://randomkeygen.com, elegí una de las claves largas)
   - `NODE_ENV` → `production`
6. Click en **Create Web Service**. Render va a instalar todo y levantar el
   servidor. Al terminar te va a dar una URL pública, algo como
   `https://magistro.onrender.com`.

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

- **Docentes**: entrá a `https://tu-app.onrender.com/docente.html`, hacé clic
  en "Registrate" la primera vez, y a partir de ahí "Ingresar" con mail y
  contraseña. Todo lo que cargues se guarda automáticamente en la base de
  datos (ya no depende del navegador ni del dispositivo).
- **Estudiantes**: entrá a `https://tu-app.onrender.com/portal-estudiante.html`
  e ingresá tu número de DNI. Vas a ver el cronograma, tus notas y tu
  asistencia de cada curso donde estés cargado (nunca la de tus compañeros).

> **Nota sobre el plan gratuito de Render**: el servicio se "duerme" después
> de 15 minutos sin uso, y tarda ~30-50 segundos en despertar cuando alguien
> vuelve a entrar. Los datos NUNCA se pierden (están en Neon, que es aparte).
> Si eso te molesta, Render tiene un plan pago desde ~$7/mes que evita el
> dormido.

---

## Estructura del proyecto

```
magistro-backend/
├── schema.sql              ← tablas SQL (Postgres)
├── server.js                ← servidor Express
├── package.json
├── .env.example              ← plantilla de variables de entorno
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
