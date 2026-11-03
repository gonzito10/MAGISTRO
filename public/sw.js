/* Service worker de Magistro.
 * - Guarda en caché SOLO archivos estáticos (páginas, íconos, fuentes y librerías).
 * - NUNCA toca /api/*: notas, asistencia y sesión siempre vienen del servidor,
 *   así no se muestran datos viejos ni se guarda información de nadie en el celular.
 * - Recibe avisos push (mensajes y tablón): muestra la notificación y abre la app al tocarla.
 *   El texto de los mensajes nunca viaja en la notificación.
 * Para forzar una actualización de los archivos guardados, subí el número de VERSION. */
const VERSION = 'v4';
const SHELL = 'magistro-shell-' + VERSION;
const RUNTIME = 'magistro-runtime-' + VERSION;

const PRECACHE = [
  '/',
  '/docente.html',
  '/portal-estudiante.html',
  '/manifest.webmanifest',
  '/tokens.css',
  '/pwa.js',
  '/a11y.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// Orígenes externos que se guardan para que la app abra sin conexión (fuentes y librerías de exportación)
const EXTERNAL_OK = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (cache) { return cache.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== RUNTIME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function putInCache(cacheName, request, response) {
  if (response && (response.ok || response.type === 'opaque')) {
    var copy = response.clone();
    caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}

// Responde desde caché al instante y actualiza en segundo plano.
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (res) { return putInCache(cacheName, request, res); }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

// Páginas: primero la red (así ves las versiones nuevas); si no hay conexión, la copia guardada.
function networkFirstPage(request) {
  return fetch(request).then(function (res) { return putInCache(SHELL, request, res); }).catch(function () {
    return caches.match(request, { ignoreSearch: true }).then(function (cached) {
      return cached || caches.match('/');
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Nunca interceptar la API ni el chequeo de salud: siempre directo a la red.
    if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/health') return;
    if (url.pathname === '/sw.js') return;

    if (request.mode === 'navigate') {
      event.respondWith(networkFirstPage(request));
    } else {
      event.respondWith(staleWhileRevalidate(request, SHELL));
    }
    return;
  }

  if (EXTERNAL_OK.indexOf(url.hostname) !== -1) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
  }
});

// ── Avisos push ──
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var url = typeof data.url === 'string' ? data.url : '/';
  if (url.charAt(0) !== '/' || url.charAt(1) === '/') url = '/'; // solo rutas de este mismo sitio
  event.waitUntil(self.registration.showNotification(data.title || 'MAGISTRO', {
    body: data.body || 'Tenés novedades.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'magistro',
    renotify: true,
    data: { url: url }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  var base = url.split('#')[0];
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).pathname === base && 'focus' in c) {
          return c.focus().then(function (w) { if (w && 'navigate' in w && url.indexOf('#') !== -1) return w.navigate(url); });
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
