/* ¿Qué vemos? · TV app (UI + business logic). ES5, no modules, no framework.
   Never calls sagem.* — everything device-specific goes through TP.* (src/platform/totalplay). */
(function (QV, TP) {
  'use strict';

  /* ---------- config / helpers ---------- */
  var DEMO = /[?&]demo(=|&|$)/.test(location.search);
  var POLL_MS = 2000, LAUNCH_SIM_MS = 1600, GOAL = 3;  /* the round ends when everyone agrees on GOAL movies */
  var GENRES = [[28,'Acción'],[12,'Aventura'],[16,'Animación'],[35,'Comedia'],[80,'Crimen'],[99,'Documental'],[18,'Drama'],[10751,'Familia'],[14,'Fantasía'],[36,'Historia'],[27,'Terror'],[10402,'Música'],[9648,'Misterio'],[10749,'Romance'],[878,'Ciencia ficción'],[53,'Suspenso'],[10752,'Bélica'],[37,'Western']];
  var GNAME = {}; for (var gi = 0; gi < GENRES.length; gi++) GNAME[GENRES[gi][0]] = GENRES[gi][1];
  var AV = [['#FFFFFF','#111'],['#F38BC9','#fff'],['#5470D6','#fff'],['#9678FF','#fff'],['#7FC8E8','#111'],['#FFC2E2','#111']];
  var store = DEMO ? QV.demoStore : QV.firestoreStore;
  var catalog = DEMO ? QV.catalog.demo : QV.catalog.real;
  var img = QV.catalog.img;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function includes(arr, v) { if (!arr) return false; for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
  function avatar(p, i) { var c = AV[i % AV.length]; return '<span class="av" style="background:' + c[0] + ';color:' + c[1] + '">' + esc((p.name || '?').charAt(0).toUpperCase()) + '</span>'; }
  function genresText(g) { var out = []; for (var i = 0; i < (g || []).length && out.length < 3; i++) if (GNAME[g[i]]) out.push(GNAME[g[i]]); return out.join(' · '); }
  function altTitle(m) { return m.en || m.o || ''; }
  function sortByJoined(ps) { return ps.sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); }); }
  function phoneUrl(code) {
    var base = location.href.replace(/tv\.html.*$/, '').replace(/[?#].*$/, '');
    return base + '?sala=' + code + (DEMO ? '&demo=1' : '');
  }

  /* ---------- state ---------- */
  var S = { provs: {}, provsOpen: false, provsReturn: null, code: null, room: null, players: [], screen: 'boot', resKey: null, timer: null, standby: false, launchOpen: false, lastFocus: null, offline: false };

  function show(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].hidden = screens[i].getAttribute('data-screen') !== name;
    S.screen = name;
  }
  function setOffline(off) {
    if (S.offline === off) return; S.offline = off;
    $('netBanner').hidden = !off;
    TP.debug.log(off ? 'network: room unreachable' : 'network: back');
  }

  /* ---------- room lifecycle ---------- */
  function newCode() {
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  /* Abierto desde Companion (companion/tv.html): permite volver a la Sala TV. */
  var FROM_COMPANION = /[?&]back=companion(&|$)/.test(location.search);
  /* Sala del Companion: viene en ?cp=; si no (versión en caché de la Sala TV), la última que guardó esa TV en este navegador. */
  var CP_CODE = ((location.search.match(/[?&]cp=([A-Za-z0-9]{4})/) || [])[1] || '').toUpperCase();
  if (FROM_COMPANION && !CP_CODE) { try { CP_CODE = (localStorage.getItem('cp-tv-code' + (DEMO ? '-demo' : '')) || '').toUpperCase(); } catch (e) { CP_CODE = ''; } }
  function backToCompanion() {
    var q = (DEMO ? '&demo=1' : '') + TP.lifecycle.returnQuery();
    location.href = 'companion/tv.html' + (q ? '?' + q.slice(1) : '');
  }
  function createRoom(cb) {
    var tries = 0;
    (function attempt() {
      var code = newCode();
      store.getRoom(code, function (err, existing) {
        if (err) return cb(err);
        if (existing && tries++ < 6) return attempt();
        store.createRoom(code, { status: 'lobby', host: 'tv', round: 1, createdAt: Date.now(), deck: null }, function (err2) {
          if (err2) return cb(err2);
          cb(null, code);
        });
      });
    })();
  }
  function startRoom() {
    stopPolling(); S.code = null; S.room = null; S.players = []; S.resKey = null;
    show('boot'); $('bootText').textContent = 'Creando la sala…';
    createRoom(function (err, code) {
      if (err) { $('bootText').innerHTML = 'No se pudo crear la sala.<small class="boot-why">' + esc(err.message || 'error desconocido') + ' · reintentando…</small>'; TP.debug.log('createRoom failed: ' + err.message); setTimeout(startRoom, 4000); return; }
      S.code = code; TP.debug.log('room ' + code + ' created');
      renderQR(code);
      startPolling(); poll();
    });
  }

  /* ---------- polling ---------- */
  function startPolling() { stopPolling(); S.timer = setInterval(poll, POLL_MS); }
  function stopPolling() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
  var polling = false;
  function poll() {
    if (!S.code || S.standby || polling) return;
    polling = true;
    var room = null, players = null, pending = 2, failed = false;
    function done() { if (--pending) return; polling = false; if (failed) { setOffline(true); return; } setOffline(false); S.room = room; S.players = sortByJoined(players); render(); }
    store.getRoom(S.code, function (err, r) { if (err) failed = true; room = r; done(); });
    store.listPlayers(S.code, function (err, ps) { if (err) failed = true; players = ps || []; done(); });
  }

  /* ---------- render router ---------- */
  function render() {
    if (!S.room) { show('boot'); $('bootText').textContent = 'Esta sala ya no existe.'; setTimeout(startRoom, 2500); return; }
    var st = S.room.status;
    if (st === 'lobby') renderLobby();
    else if (st === 'playing') {
      if (S.players.length && (allDone() || liveMatches().length >= GOAL)) { store.updateRoom(S.code, { status: 'results' }, function () { poll(); }); }
      renderPlaying();
    }
    else if (st === 'results') renderResults();
    TP.focus.ensure();
  }
  function allDone() { for (var i = 0; i < S.players.length; i++) if (!S.players[i].done) return false; return true; }

  /* ---------- lobby ---------- */
  function renderQR(code) {
    var url = phoneUrl(code), q = qrcode(0, 'M'); q.addData(url); q.make();
    var n = q.getModuleCount(), remPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 28;
    var m = Math.max(3, Math.floor(remPx * 12.5 / n)), html = '', quiet = 2;
    for (var r = -quiet; r < n + quiet; r++) {
      html += '<span class="r" style="height:' + m + 'px">';
      for (var c = -quiet; c < n + quiet; c++) {
        var dark = r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
        html += '<span class="' + (dark ? 'd' : '') + '" style="width:' + m + 'px;height:' + m + 'px"></span>';
      }
      html += '</span>';
    }
    $('qr').innerHTML = html;
    $('qrUrl').textContent = url.replace(/^https?:\/\//, '');
    $('lobbyCode').textContent = code; $('playCode').textContent = code; $('resCode').textContent = code;
  }
  function renderLobby() {
    if (S.screen !== 'lobby') { show('lobby'); S.resKey = null; }
    var ps = S.players, h = '';
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      h += '<div class="row">' + avatar(p, i) + '<div class="row-main"><p class="row-name">' + esc(p.name) + '</p><p class="row-sub">' +
        esc(p.genres && p.genres.length ? genresText(p.genres) : 'Cualquier género') + '</p></div>' +
        '<span class="status ' + (p.ready ? 'on' : '') + '">' + (p.ready ? 'Ya eligió' : 'Eligiendo') + '</span></div>';
    }
    $('lobbyList').innerHTML = h;
    $('lobbyEmpty').hidden = ps.length > 0;
    $('playerCount').textContent = ps.length ? ps.length + (ps.length === 1 ? ' persona' : ' personas') : '';
    if (S.room.building && (!S.room.buildingAt || Date.now() - S.room.buildingAt < 40000)) $('lobbyEmpty').hidden = false, $('lobbyEmpty').textContent = S.room.building + ' está buscando las películas…';
    else $('lobbyEmpty').textContent = 'Esperando a que alguien escanee el código…';
  }

  /* ---------- playing ---------- */
  function liveMatches() {
    var deck = S.room.deck || [], out = [];
    if (!S.players.length) return out;
    for (var i = 0; i < deck.length; i++) {
      var all = true;
      for (var j = 0; j < S.players.length; j++) if (!includes(S.players[j].likes, deck[i].id)) { all = false; break; }
      if (all) out.push(deck[i]);
    }
    return out;
  }
  /* Empty slot: dashed poster frame with its number; the titles stay a surprise until the results. */
  function emptySlot(k, label) {
    return '<div class="slot empty"><div class="slot-poster"><span class="slot-num">' + (k + 1) + '</span><span class="slot-q">?</span></div>' +
      '<div class="slot-info"><p class="slot-wait">' + label + '</p></div></div>';
  }
  function renderPlaying() {
    if (S.screen !== 'playing') {
      show('playing'); S.resKey = null;
      var e = ''; for (var k = 0; k < GOAL; k++) e += emptySlot(k, 'Por descubrir');
      $('playSlots').innerHTML = e;
    }
    fitStage('playing');
    var ps = S.players, h = '';
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      h += '<span class="person' + (p.done ? ' done' : '') + '">' + avatar(p, i) + esc(p.name) +
        '<em>' + (p.done ? 'Terminó' : 'Deslizando') + '</em></span>';
    }
    $('playList').innerHTML = h;
  }

  /* ---------- results ---------- */
  /* Up to GOAL movies everyone liked (deck order). With none, up to GOAL of the most-voted, marked "x de n". */
  function computeResults() {
    var deck = S.room.deck || [], n = S.players.length, scored = [];
    for (var i = 0; i < deck.length; i++) {
      var yes = 0; for (var j = 0; j < n; j++) if (includes(S.players[j].likes, deck[i].id)) yes++;
      if (yes > 0) scored.push({ m: deck[i], i: i, yes: yes });
    }
    var full = [];
    for (var k = 0; k < scored.length; k++) if (scored[k].yes === n) full.push(scored[k]);
    full.sort(function (a, b) { return a.i - b.i; });
    if (full.length) return { picks: full.slice(0, GOAL), full: Math.min(full.length, GOAL), n: n };
    if (n < 2) return { picks: [], full: 0, n: n };
    scored.sort(function (a, b) { return b.yes - a.yes || a.i - b.i; });
    return { picks: scored.slice(0, GOAL), full: 0, n: n };
  }
  function filledSlot(x, k, n) {
    var m = x.m, tag = x.yes === n ? (n > 1 ? 'Todos dijeron sí' : 'Dijo que sí') : x.yes + ' de ' + n;
    return '<div class="slot filled" data-focusable data-action="moreProvs" data-movie="' + m.id + '" style="animation-delay:' + (k * 260) + 'ms">' +
      '<div class="slot-poster"><span class="slot-num">' + (k + 1) + '</span><img src="' + img(m.p, 'w342') + '" alt=""></div>' +
      '<div class="slot-info"><span class="tag ' + (x.yes === n ? '' : 'soft') + '">' + tag + '</span>' +
      '<p class="slot-title">' + esc(m.t) + '</p>' +
      '<p class="slot-sub">' + esc([altTitle(m), m.y].join(altTitle(m) && m.y ? ' · ' : '')) + '</p>' +
      '<p class="slot-where" data-prov="' + m.id + '">Buscando dónde verla…</p></div></div>';
  }
  function renderResults() {
    var sig = []; for (var i = 0; i < S.players.length; i++) sig.push((S.players[i].likes || []).length);
    var key = 'res:' + S.room.round + ':' + sig.join(',');
    if (S.screen === 'results' && S.resKey === key) return;
    S.resKey = key; show('results');
    var R = computeResults(), n = R.n, h = '';
    $('resPeople').textContent = n + (n === 1 ? ' persona' : ' personas');
    $('resTitle').textContent = R.full >= GOAL ? '¡Ya tienen sus ' + GOAL + ' películas!' : R.full === 1 ? 'Coincidieron en una película'
      : R.full ? 'Coincidieron en ' + R.full + ' películas' : 'No coincidieron esta vez';
    $('resLede').textContent = R.full ? 'Elijan una o jueguen otra ronda.'
      : R.picks.length ? 'Las más votadas. Otra ronda trae películas nuevas.' : 'Otra ronda trae películas nuevas.';
    for (var k = 0; k < GOAL; k++) h += R.picks[k] ? filledSlot(R.picks[k], k, n) : emptySlot(k, 'Sin coincidencia');
    $('resSlots').innerHTML = h;
    for (var d = 0; d < R.picks.length; d++) loadProviders(R.picks[d].m);
    fitStage('results');
    var firstPoster = document.querySelector('#resSlots .slot.filled');
    if (firstPoster) TP.focus.setFocus(firstPoster); else TP.focus.ensure('[data-action="newRound"]');
  }
  /* No scroll on TV: if the screen's content is taller than the screen (other fonts, 720p, an extra header
     button…), shrink the posters step by step until everything fits. Measured, so it adapts to whatever the
     STB actually renders. */
  var POSTER_H = 17.4, POSTER_MIN = 8;   /* posters are the hero now: start big, shrink only if the screen needs it */
  function fitStage(name) {
    var sec = document.querySelector('[data-screen="' + name + '"]'); if (!sec || sec.hidden) return;
    var posters = sec.querySelectorAll('.slot-poster'), h = POSTER_H, i;
    function apply() { for (i = 0; i < posters.length; i++) { posters[i].style.height = h + 'rem'; posters[i].style.width = (h * 2 / 3) + 'rem'; } }
    apply();
    var guard = 0;
    while (sec.scrollHeight > sec.clientHeight + 1 && h > POSTER_MIN && guard++ < 40) { h -= .3; apply(); }
  }
  function provBtn(pr, movieId, short) {
    var desc = TP.apps.describe(pr.provider_name);
    return '<button class="pbtn" data-focusable data-action="open" data-provider="' + esc(pr.provider_name) + '" data-movie="' + movieId + '">' +
      (pr.logo_path ? '<img src="' + img(pr.logo_path, 'w92') + '" alt="">' : '<span class="nologo">' + esc(desc.label.charAt(0)) + '</span>') +
      '<span class="pl">' + (short ? '' : 'Ver en ') + esc(desc.label) + '</span></button>';
  }
  /* OK on a poster: every platform for that movie in one dialog (2 columns, no scroll). */
  function openProvs(movieId) {
    var m = findMovie(movieId); if (!m) return;
    var info = S.provs[movieId], list = (info && info.flat) || [], h = '', sub;
    for (var i = 0; i < list.length; i++) h += provBtn(list[i], movieId, true);  /* the dialog title already says 'Dónde verla' */
    if (!info) sub = 'Buscando dónde verla…';
    else if (list.length) sub = list.length + (list.length === 1 ? ' plataforma' : ' plataformas') + ' en México';
    else if (info.other.length) sub = 'No está en suscripción. Solo en renta o compra: ' + info.other[0].provider_name + '.';
    else sub = 'No está en streaming en México.';
    $('provsGrid').innerHTML = h;
    $('provsPoster').src = img(m.p, 'w342');
    $('provsTitle').textContent = m.t;
    $('provsSub').textContent = sub;
    if (!S.provsOpen) S.provsReturn = TP.focus.current();
    S.provsOpen = movieId;
    $('provs').hidden = false;
    TP.focus.setScope($('provs'), list.length ? '#provsGrid .pbtn' : '[data-action="closeProvs"]');
  }
  function closeProvs() {
    if (!S.provsOpen) return;
    S.provsOpen = false; $('provs').hidden = true;
    TP.focus.setScope(null);
    if (S.provsReturn && document.body.contains(S.provsReturn)) TP.focus.setFocus(S.provsReturn); else TP.focus.ensure();
  }
  function loadProviders(m) {
    catalog.details(m.id, function (err, d) {
      var pv = err ? { flat: [], other: [] } : QV.catalog.providersOf(d);
      S.provs[m.id] = pv;
      var line = document.querySelector('[data-prov="' + m.id + '"]');
      if (line) {
        var f = pv.flat;
        line.textContent = err ? 'Sin información de plataformas'
          : f.length ? 'En ' + TP.apps.describe(f[0].provider_name).label + (f.length > 1 ? ' y ' + (f.length - 1) + ' más' : '')
          : pv.other.length ? 'Solo en renta o compra' : 'No está en streaming en México';
      }
      if (S.provsOpen === m.id) openProvs(m.id);   /* dialog was opened while this was still loading */
      fitStage('results');
    });
  }

  /* ---------- launch overlay (simulated — see src/platform/totalplay/apps.js) ---------- */
  function findMovie(id) {
    var deck = S.room && S.room.deck || [];
    for (var i = 0; i < deck.length; i++) if (deck[i].id === id) return deck[i];
    return null;
  }
  var launchTimer = null;
  function openLaunch(providerName, movieId) {
    var m = findMovie(movieId); if (!m) return;
    var desc = TP.apps.describe(providerName);
    var real = TP.apps.open(providerName, m);  /* false until Totalplay documents the launch API */
    if (real) return;
    S.lastFocus = TP.focus.current(); S.launchOpen = true;
    $('launchPoster').src = img(m.p, 'w342');
    $('launchEyebrow').textContent = 'Abriendo ' + desc.label + '…';
    $('launchTitle').textContent = m.t;
    $('launchSub').textContent = [altTitle(m), m.y].join(altTitle(m) && m.y ? ' · ' : '');
    var prog = $('launchProgress'); prog.className = 'launch-progress';
    $('launch').hidden = false;
    setTimeout(function () { prog.className = 'launch-progress go'; }, 30);
    if (launchTimer) clearTimeout(launchTimer);
    launchTimer = setTimeout(function () { $('launchEyebrow').textContent = 'Reproduciendo en ' + desc.label; }, LAUNCH_SIM_MS);
    TP.focus.setScope($('launch'), '[data-action="closeLaunch"]');
  }
  function closeLaunch() {
    if (!S.launchOpen) return;
    S.launchOpen = false; $('launch').hidden = true;
    if (launchTimer) { clearTimeout(launchTimer); launchTimer = null; }
    TP.focus.setScope(S.provsOpen ? $('provs') : null);   /* back to the platforms dialog if it was open */
    if (S.lastFocus) TP.focus.setFocus(S.lastFocus); else TP.focus.ensure();
  }

  /* ---------- actions ---------- */
  /* Everything anyone voted on in this room so far: the next deck skips all of it (same rule as the phone). */
  function seenSoFar() {
    var seen = {}, out = [], prev = S.room.seen || [], i, j;
    function add(id) { if (!seen[id]) { seen[id] = 1; out.push(id); } }
    for (i = 0; i < prev.length; i++) add(prev[i]);
    for (i = 0; i < S.players.length; i++) {
      var p = S.players[i], l = (p.likes || []).concat(p.passes || []);
      for (j = 0; j < l.length; j++) add(l[j]);
    }
    return out;
  }
  function playerIds() { var ids = []; for (var i = 0; i < S.players.length; i++) ids.push(S.players[i].id); return ids; }
  var actions = {
    newRoom: function () { closeLaunch(); closeProvs(); startRoom(); },
    forceResults: function () { store.updateRoom(S.code, { status: 'results' }, function () { poll(); }); },
    newRound: function () {
      store.resetRound(S.code, playerIds(), { status: 'lobby', deck: null, building: null, seen: seenSoFar(), round: (S.room.round || 1) + 1 }, function () { poll(); });
    },
    closeLaunch: closeLaunch,
    moreProvs: function (el) { openProvs(Number(el.getAttribute('data-movie'))); },
    closeProvs: closeProvs,
    backToCompanion: backToCompanion,
    open: function (el) { openLaunch(el.getAttribute('data-provider'), Number(el.getAttribute('data-movie'))); }
  };
  TP.focus.onActivate(function (el) {
    var a = el.getAttribute('data-action');
    if (a && actions[a]) actions[a](el);
  });

  /* ---------- input: remote control first, pointer as an extra layer ---------- */
  /* Una sola ruta para el control: teclado/control remoto del STB y comandos del celular del Companion. */
  function handleKey(k, e) {
    function stop() { if (e && e.preventDefault) e.preventDefault(); }
    if (k === 'LEFT' || k === 'RIGHT' || k === 'UP' || k === 'DOWN') { stop(); S.resAutoFocus = false; TP.focus.move(k.toLowerCase()); return; }
    if (k === 'OK') { stop(); TP.focus.activate(); return; }
    if (k === 'BACK') {
      if (S.launchOpen) { stop(); closeLaunch(); return; }   /* one level back inside the app */
      if (S.provsOpen) { stop(); closeProvs(); return; }
      if (FROM_COMPANION) { stop(); backToCompanion(); return; } /* navegación interna de la demo, no salida de la app */
      if (e) TP.lifecycle.handleRootBack(e);                  /* root: isolated, empty (R6) */
      return;
    }
    if ((k === 'MENU' || k === 'EXIT') && e) { TP.lifecycle.handleMenu(e); }     /* native; never our own exit (R6) */
  }
  window.addEventListener('keydown', function (e) {
    if (TP.lifecycle.handlePlatformEvent(e)) return;
    var k = TP.keys.normalizeKey(e);
    if (!k) return;
    handleKey(k, e);
  });

  /* Puente con el Companion: el celular vinculado a la Sala TV sigue funcionando como control dentro del juego.
     Lee rooms/{cp}/players (mismo esquema que companion/tv.js) y aplica solo los comandos nuevos. */
  (function companionBridge() {
    if (!FROM_COMPANION) return;
    /* Indicador visible del puente (ayuda a saber si el celular del Companion está escuchándose) */
    var tag = document.createElement('div');
    tag.style.cssText = 'position:fixed;right:1.2rem;top:1rem;z-index:70;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;font-size:.62rem;font-weight:600;padding:.35rem .7rem;border-radius:999px';
    document.body.appendChild(tag);
    function status(t) { tag.textContent = t; }
    if (!CP_CODE) { status('Control del celular: sin sala del Companion · v5'); return; }
    status('Control del celular · sala ' + CP_CODE + ' · conectando… · v5');
    var lastSeq = {}, primed = false, busy = false;
    function listDemo(cb) {
      var out = [], pre = 'cp-demo-' + CP_CODE + '-p-';
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) { var p = JSON.parse(localStorage.getItem(k)); if (p) { p.id = k.substring(pre.length); out.push(p); } } } } catch (e) { /* ignore */ }
      cb(null, out);
    }
    function apply(c) {
      if (c.t === 'key') handleKey(c.k, null);
      else if (c.t === 'home' || c.t === 'open' || c.t === 'search' || c.t === 'game') backToCompanion();
    }
    function tick() {
      if (busy || S.standby) return; busy = true;
      (DEMO ? listDemo : function (cb) { QV.firestoreStore.listPlayers(CP_CODE, cb); })(function (err, ps) {
        busy = false;
        if (err || !ps) { status('Control del celular · sala ' + CP_CODE + ' · sin conexión (' + (err ? err.message : '?') + ') · v5'); return; }
        status('Control del celular · sala ' + CP_CODE + ' · ' + ps.length + ' vinculado(s) · v5');
        for (var i = 0; i < ps.length; i++) {
          var cmds = ps[i].cmds || [], id = ps[i].id;
          for (var j = 0; j < cmds.length; j++) {
            if (!cmds[j]) continue;
            if (!primed || lastSeq[id] === undefined) { lastSeq[id] = Math.max(lastSeq[id] || 0, cmds[j].seq); continue; }
            if (cmds[j].seq > lastSeq[id]) { lastSeq[id] = cmds[j].seq; apply(cmds[j]); }
          }
          if (lastSeq[id] === undefined) lastSeq[id] = 0;
        }
        primed = true;
      });
    }
    setInterval(tick, 600); tick();
  })();

  TP.focus.enablePointer();

  /* ---------- lifecycle ---------- */
  TP.lifecycle.on('standby', function () { S.standby = true; stopPolling(); TP.debug.log('standby: polling paused'); });
  TP.lifecycle.on('wakeup', function () { S.standby = false; startPolling(); poll(); TP.debug.log('wakeup: polling resumed'); });

  if (FROM_COMPANION) { var bb = document.querySelectorAll('[data-action="backToCompanion"]'); for (var bi = 0; bi < bb.length; bi++) bb[bi].hidden = false; }

  /* ---------- boot ---------- */
  TP.debug.log('boot on ' + TP.device.getModel() + ' @ ' + TP.device.getHdmiResolution() + (DEMO ? ' (demo)' : ''));
  startRoom();
})(window.QV, window.TP);
