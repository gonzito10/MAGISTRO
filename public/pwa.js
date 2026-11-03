// Registra el service worker (solo en HTTPS o localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* sin SW la app funciona igual */ });
  });
}

// ── Avisos al celular (notificaciones push) ──
// MagistroPush.estado(rol) / activar(rol) / desactivar(rol), con rol = 'docente' | 'estudiante'.
// activar() tiene que llamarse desde un toque del usuario (el navegador pide el permiso).
window.MagistroPush = (function () {
  var API = { docente: '/api/docente/mensajes/push', estudiante: '/api/estudiante/push' };

  function soportado() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  // En iPhone/iPad los avisos solo funcionan con la app agregada a la pantalla de inicio.
  function faltaInstalarEnIOS() {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var instalada = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return ios && !instalada;
  }
  function claveABytes(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function pedir(url, opciones) {
    opciones = opciones || {};
    opciones.credentials = 'same-origin';
    return fetch(url, opciones).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'No se pudo completar la acción.');
        return j;
      });
    });
  }
  function post(url, body) {
    return pedir(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function suscripcionActual() {
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); });
  }

  // → { soportado, instalar, habilitado, permiso, activo }
  function estado(rol) {
    var base = { soportado: soportado(), instalar: faltaInstalarEnIOS(), habilitado: false, permiso: 'default', activo: false };
    if (!base.soportado) return Promise.resolve(base);
    base.permiso = Notification.permission;
    return pedir(API[rol] + '/config').then(function (cfg) {
      base.habilitado = !!cfg.habilitado;
      return suscripcionActual();
    }).then(function (sub) {
      base.activo = !!sub && base.permiso === 'granted';
      return base;
    }).catch(function () { return base; });
  }

  function activar(rol) {
    if (!soportado()) return Promise.reject(new Error('Este dispositivo no admite avisos.'));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('No diste permiso para recibir avisos. Podés activarlo desde los ajustes del navegador.');
      return pedir(API[rol] + '/config');
    }).then(function (cfg) {
      if (!cfg.habilitado || !cfg.publicKey) throw new Error('Los avisos al celular todavía no están configurados.');
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(cfg.publicKey) });
        });
      });
    }).then(function (sub) {
      return post(API[rol] + '/subscribe', { subscription: sub.toJSON() });
    });
  }

  function desactivar(rol) {
    return suscripcionActual().then(function (sub) {
      if (!sub) return null;
      var endpoint = sub.endpoint;
      return post(API[rol] + '/unsubscribe', { endpoint: endpoint }).then(function () { return sub.unsubscribe(); });
    });
  }

  return { estado: estado, activar: activar, desactivar: desactivar };
})();

