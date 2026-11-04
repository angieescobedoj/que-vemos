/* Movie details (where to watch in MX) — TMDB over XHR, or a deterministic mock in demo mode.
   Image sizes are chosen per slot by the UI (R2: decoded pixels cost RAM, not file size). */
(function (QV) {
  'use strict';
  var TMDB_KEY = 'a7795e812c110c40515e414ceb379fac';
  var cache = {};

  function providersOf(d) {
    var mx = (d && d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.MX) || {};
    var flat = mx.flatrate || [], other = [].concat(mx.rent || [], mx.buy || []), seen = {}, uniq = [];
    for (var i = 0; i < other.length; i++) if (!seen[other[i].provider_name]) { seen[other[i].provider_name] = 1; uniq.push(other[i]); }
    return { flat: flat, other: uniq };
  }

  var real = {
    details: function (id, cb) {
      if (cache[id]) return cb(null, cache[id]);
      var url = 'https://api.themoviedb.org/3/movie/' + id + '?api_key=' + TMDB_KEY + '&language=es-MX&append_to_response=watch/providers';
      QV.http.get(url, function (err, data) { if (err) return cb(err); cache[id] = data; cb(null, data); });
    }
  };

  var demo = {
    details: function (id, cb) {
      var names = ['Netflix', 'Amazon Prime Video', 'Max', 'Disney Plus', 'ViX', 'Apple TV Plus', 'Mercado Play'];
      var a = names[id % names.length], b = names[(id * 7 + 3) % names.length], flat = [{ provider_name: a }];
      if (id % 3 === 0 && b !== a) flat.push({ provider_name: b });
      var d = { overview: 'Sinopsis de prueba del modo demo.', runtime: 85 + (id % 70), vote_average: 6 + (id % 30) / 10,
        'watch/providers': { results: { MX: { flatrate: id % 11 === 0 ? [] : flat, rent: id % 11 === 0 ? [{ provider_name: 'Apple TV' }] : [] } } } };
      setTimeout(function () { cb(null, d); }, 150);
    }
  };

  /* Same fallback chain as the phone: TMDB host → TMDB second host → wsrv.nl proxy. */
  var HOSTS = ['https://image.tmdb.org/t/p/', 'https://media.themoviedb.org/t/p/', 'https://wsrv.nl/?url=image.tmdb.org/t/p/'];
  var hostIdx = 0;
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    var m = (el.getAttribute('src') || '').match(/\/t\/p\/(\w+)(\/[^?&#]+)/);
    if (!m) return;
    var next = Number(el.getAttribute('data-host') || hostIdx) + 1;
    if (next >= HOSTS.length) return;
    el.setAttribute('data-host', next); if (next > hostIdx) hostIdx = next;
    el.src = HOSTS[next] + m[1] + m[2];
  }, true);
  QV.catalog = { real: real, demo: demo, providersOf: providersOf,
    img: function (p, size) { return !p ? '' : (p.indexOf('data:') === 0 ? p : HOSTS[hostIdx] + size + p); } };
})(window.QV = window.QV || {});
