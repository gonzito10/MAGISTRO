/* Temas de color de Magistro (lo cargan docente.html y portal-estudiante.html).
 * - Los colores viven en tokens.css (html[data-theme="clave"] y, para el modo oscuro,
 *   html[data-theme="clave"] body.dark-mode). Acá solo está la lista para armar el selector.
 * - Se carga SIN defer en el <head>: aplica el tema guardado antes del primer dibujo (sin parpadeo).
 * - Dónde se guarda la elección (solo en este navegador, nunca en el servidor):
 *     docente    -> gd_config.theme  (lo escribe saveConfig() de docente.html)
 *     estudiante -> magistro_theme   (lo escribe el portal)
 * Si agregás un tema: sumalo acá y en tokens.css (claro y oscuro), y subí VERSION en sw.js. */
(function () {
  var LISTA = [
    { clave: 'amanecer', nombre: 'Amanecer', desc: 'Rojo, naranja y dorado',
      claro: ['#7c2020', '#d45a2a', '#f5a623', '#fff8f0'], oscuro: ['#1c1410', '#2a201a', '#e2793f', '#f2a273'] },
    { clave: 'pizarra', nombre: 'Pizarra', desc: 'Azul profundo y celeste',
      claro: ['#1e2a3a', '#2e7d9f', '#3eb8d0', '#f0f4f8'], oscuro: ['#0f1a24', '#172433', '#44a9cc', '#7fd0ea'] },
    { clave: 'bosque', nombre: 'Bosque', desc: 'Verde esmeralda y salvia',
      claro: ['#1b3a2f', '#2d7a5b', '#5cc49a', '#f2f8f5'], oscuro: ['#0f1a15', '#172720', '#3fb386', '#7fdcb4'] },
    { clave: 'aurora', nombre: 'Aurora', desc: 'Violeta y lila suave',
      claro: ['#3b1f5e', '#7c4dbd', '#e8a6f0', '#faf5ff'], oscuro: ['#17111f', '#231a30', '#a67ae6', '#cdb0f5'] },
    { clave: 'oceano', nombre: 'Océano', desc: 'Azul marino y cielo',
      claro: ['#0a2a4a', '#1565a8', '#5ba4e5', '#edf5ff'], oscuro: ['#0b1622', '#122436', '#4a98e0', '#8cc3f5'] },
    { clave: 'coral', nombre: 'Coral', desc: 'Rosa y frambuesa',
      claro: ['#6b1a2e', '#c44569', '#f48fb1', '#fff0f5'], oscuro: ['#1f1218', '#2d1a23', '#ee6a94', '#f7a8c2'] },
    { clave: 'carbon', nombre: 'Carbón', desc: 'Gris oscuro y plata',
      claro: ['#1a1a1a', '#3a3a3a', '#7a7a7a', '#f5f5f5'], oscuro: ['#141414', '#1f1f1f', '#a8a8a8', '#e0e0e0'] },
    { clave: 'menta', nombre: 'Menta', desc: 'Verde agua y turquesa',
      claro: ['#1a4a3a', '#2aa87a', '#80e5c0', '#f0fdf8'], oscuro: ['#0e1a17', '#16282a', '#2ab98a', '#80e5c0'] }
  ];
  var MAPA = {};
  LISTA.forEach(function (t) { MAPA[t.clave] = t; });

  var ES_DOCENTE = /docente/.test(location.pathname);

  function guardado() {
    try {
      if (ES_DOCENTE) return (JSON.parse(localStorage.getItem('gd_config') || '{}') || {}).theme || null;
      return localStorage.getItem('magistro_theme');
    } catch (e) { return null; }
  }
  function actual() { return document.documentElement.getAttribute('data-theme') || 'amanecer'; }
  function esOscuro() { return !!(document.body && document.body.classList.contains('dark-mode')); }

  // El color de la barra del navegador / de la app instalada acompaña al fondo del tema y del modo
  function actualizarBarra() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m || !document.body) return;
    var bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    if (bg) m.setAttribute('content', bg);
  }

  // Cambia el tema en pantalla. NO guarda: guarda quien llama (docente: saveConfig; portal: elegir)
  function aplicar(clave) {
    if (!MAPA[clave]) clave = 'amanecer';
    document.documentElement.setAttribute('data-theme', clave);
    actualizarBarra();
    return clave;
  }

  // Dibuja la grilla de temas dentro de `cont`. `alElegir(clave)` se llama después de aplicar el tema.
  // Cada tema es un <button> con aria-pressed; el foco se mantiene al elegir (no se vuelve a dibujar).
  function montarSelector(cont, alElegir) {
    if (!cont) return;
    var oscuro = esOscuro(), act = actual();
    cont.innerHTML = '';
    cont.className = 'tema-grid';
    cont.setAttribute('role', 'group');
    cont.setAttribute('aria-label', 'Paleta de colores');
    LISTA.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tema-card';
      b.setAttribute('data-tema', t.clave);
      b.setAttribute('aria-pressed', String(t.clave === act));

      var sw = document.createElement('span');
      sw.className = 'tema-sw';
      (oscuro ? t.oscuro : t.claro).forEach(function (c) {
        var s = document.createElement('span');
        s.style.background = c;
        sw.appendChild(s);
      });
      var txt = document.createElement('span');
      txt.className = 'tema-txt';
      var n = document.createElement('span'); n.className = 'tema-nombre'; n.textContent = t.nombre;
      var d = document.createElement('span'); d.className = 'tema-desc'; d.textContent = t.desc;
      txt.appendChild(n); txt.appendChild(d);
      var ck = document.createElement('span');
      ck.className = 'tema-check'; ck.setAttribute('aria-hidden', 'true'); ck.textContent = '✓';

      b.appendChild(sw); b.appendChild(txt); b.appendChild(ck);
      b.addEventListener('click', function () {
        var k = aplicar(t.clave);
        cont.querySelectorAll('.tema-card').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x.getAttribute('data-tema') === k));
        });
        if (alElegir) alElegir(k);
      });
      cont.appendChild(b);
    });
  }

  // Tema guardado, antes del primer dibujo
  var g = guardado();
  if (g && MAPA[g]) document.documentElement.setAttribute('data-theme', g);

  window.MagistroTemas = {
    lista: LISTA, mapa: MAPA,
    actual: actual, aplicar: aplicar, montarSelector: montarSelector, actualizarBarra: actualizarBarra
  };
})();
