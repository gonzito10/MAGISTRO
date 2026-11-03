// Registra el service worker (solo en HTTPS o localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* sin SW la app funciona igual */ });
  });
}
