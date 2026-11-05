/* Companion · logos oficiales de las apps de streaming. ES5.
   No se dibujan aquí: se piden en tiempo de ejecución al catálogo de proveedores de TMDB (la misma fuente que usa
   el juego ¿Qué vemos? para "Ver en Netflix"), se guardan 7 días en localStorage y, si no hay red, se queda el texto. */
(function (CP, QV) {
  'use strict';
  var KEY = 'a7795e812c110c40515e414ceb379fac', LS = 'cp-logos-v2', WEEK = 7 * 24 * 3600 * 1000;
  var HOSTS = ['https://image.tmdb.org/t/p/', 'https://media.themoviedb.org/t/p/', 'https://wsrv.nl/?url=image.tmdb.org/t/p/'];
  /* id de la app → id de proveedor en TMDB y nombre de respaldo */
  var MATCH = { netflix: { pid: 8, re: /^netflix$/i }, prime: { pid: 119, re: /^amazon prime video$/i }, youtube: { pid: 192, re: /^youtube$/i, alt: /youtube/i } };
  var paths = {}, waiting = [];

  function load() { try { var o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o && new Date().getTime() - o.at < WEEK) return o.paths; } catch (e) { /* sin localStorage */ } return null; }
  function save(p) { try { localStorage.setItem(LS, JSON.stringify({ at: new Date().getTime(), paths: p })); } catch (e) { /* ignore */ } }
  function done() { var w = waiting; waiting = []; for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) { /* ignore */ } } }

  function pick(list) {
    for (var id in MATCH) if (MATCH.hasOwnProperty(id) && !paths[id]) {
      var m = MATCH[id], hit = null, i;
      for (i = 0; i < list.length && !hit; i++) if (list[i].provider_id === m.pid && list[i].logo_path) hit = list[i];
      for (i = 0; i < list.length && !hit; i++) if (m.re.test(list[i].provider_name || '') && list[i].logo_path) hit = list[i];
      for (i = 0; i < list.length && !hit && m.alt; i++) if (m.alt.test(list[i].provider_name || '') && list[i].logo_path) hit = list[i];
      if (hit) paths[id] = hit.logo_path;
    }
  }
  function fetchAll() {
    var kinds = ['tv', 'movie'], n = 0;
    function next() {
      if (n >= kinds.length) { if (paths.netflix || paths.prime || paths.youtube) save(paths); done(); return; }
      var url = 'https://api.themoviedb.org/3/watch/providers/' + kinds[n++] + '?api_key=' + KEY + '&watch_region=MX&language=es-MX';
      QV.http.get(url, function (err, data) { if (!err && data && data.results) pick(data.results); next(); });
    }
    next();
  }

  /* Si un host de imágenes falla (algunas redes bloquean image.tmdb.org), prueba el siguiente; al final, quita la imagen. */
  document.addEventListener('error', function (e) {
    var el = e.target; if (!el || el.tagName !== 'IMG' || !el.getAttribute('data-logo')) return;
    var h = Number(el.getAttribute('data-host') || 0) + 1;
    if (h >= HOSTS.length) { el.parentNode && el.parentNode.removeChild(el); return; }
    el.setAttribute('data-host', h); el.src = HOSTS[h] + el.getAttribute('data-logo');
  }, true);

  CP.logos = {
    /* <img> del logo o '' si aún no hay (o no existe, como On Demand) */
    img: function (id, size, cls) {
      var p = paths[id]; if (!p) return '';
      return '<img class="' + (cls || 'logo') + '" data-logo="' + size + p + '" src="' + HOSTS[0] + size + p + '" alt="">';
    },
    ready: function (fn) { waiting.push(fn); }
  };

  var cached = load();
  if (cached) { paths = cached; setTimeout(done, 0); } else fetchAll();
})(window.CP = window.CP || {}, window.QV = window.QV || {});
