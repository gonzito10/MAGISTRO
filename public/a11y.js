// Accesibilidad por teclado para los controles hechos con <div onclick>:
// los hace enfocables (Tab) y activables con Enter o Espacio.
(function () {
  var SEL = '.sec-tab,.nav-item,.materias-toggle,.com-drop-item,.clase-header,.est-link';
  function apply(root) {
    (root || document).querySelectorAll(SEL).forEach(function (el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    });
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; apply(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!el || e.target !== el) return;       // no pisar campos de texto ni botones internos
    e.preventDefault();
    el.click();
  });
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
})();
