/* ¿Qué vemos? · TV app (UI + business logic). ES5, no modules, no framework.
   Never calls sagem.* — everything device-specific goes through TP.* (src/platform/totalplay). */
(function (QV, TP) {
  'use strict';

  /* ---------- config / helpers ---------- */
  var DEMO = /[?&]demo(=|&|$)/.test(location.search);
  var POLL_MS = 2000, LAUNCH_SIM_MS = 1600;
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
  var S = { code: null, room: null, players: [], screen: 'boot', resKey: null, timer: null, standby: false, launchOpen: false, lastFocus: null, offline: false };

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
      if (err) { $('bootText').textContent = 'No se pudo crear la sala. Revisa la conexión.'; TP.debug.log('createRoom failed: ' + err.message); setTimeout(startRoom, 4000); return; }
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
      if (S.players.length && allDone()) { store.updateRoom(S.code, { status: 'results' }, function () { poll(); }); }
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
    if (S.room.building) $('lobbyEmpty').hidden = false, $('lobbyEmpty').textContent = S.room.building + ' está buscando las películas…';
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
  function renderPlaying() {
    if (S.screen !== 'playing') { show('playing'); S.resKey = null; }
    var total = (S.room.deck || []).length, ps = S.players, h = '';
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], idx = Math.min(p.idx || 0, total), pct = total ? Math.round(idx / total * 100) : 0;
      h += '<div class="row">' + avatar(p, i) + '<div class="row-main"><p class="row-name">' + esc(p.name) + '</p>' +
        '<p class="row-sub">' + (p.done ? 'Terminó · votó ' + idx + ' películas' : 'Va en ' + Math.min(idx + 1, total) + ' de ' + total) + '</p>' +
        '<div class="prog"><i style="width:' + pct + '%"></i></div></div>' +
        '<span class="status ' + (p.done ? 'on' : '') + '">' + (p.done ? 'Terminó' : 'Deslizando') + '</span></div>';
    }
    $('playList').innerHTML = h;
    var live = liveMatches().length;   /* count only — no titles until the results screen */
    $('liveCount').textContent = live;
    $('liveLabel').textContent = live === 1 ? 'coincidencia' : 'coincidencias';
  }

  /* ---------- results ---------- */
  function computeResults() {
    var deck = S.room.deck || [], n = S.players.length, scored = [];
    for (var i = 0; i < deck.length; i++) {
      var yes = 0; for (var j = 0; j < n; j++) if (includes(S.players[j].likes, deck[i].id)) yes++;
      if (yes > 0) scored.push({ m: deck[i], i: i, yes: yes });
    }
    var full = [], partial = [];
    for (var k = 0; k < scored.length; k++) { if (scored[k].yes === n) full.push(scored[k]); else if (n > 2 && scored[k].yes >= 2) partial.push(scored[k]); }
    full.sort(function (a, b) { return a.i - b.i; });
    partial.sort(function (a, b) { return b.yes - a.yes || a.i - b.i; });
    return { full: full, partial: partial.slice(0, 10), n: n };
  }
  function resRow(x, n, hero) {
    var m = x.m;
    return '<div class="res' + (hero ? ' hero' : '') + '"><img src="' + img(m.p, hero ? 'w342' : 'w185') + '" alt="">' +
      '<div class="body"><span class="tag ' + (x.yes === n ? '' : 'soft') + '">' + (x.yes === n ? (n > 1 ? 'Todos dijeron sí' : 'Dijo que sí') : x.yes + ' de ' + n) + '</span>' +
      '<p class="res-title">' + esc(m.t) + (altTitle(m) ? ' <span>(' + esc(altTitle(m)) + ')</span>' : '') + '</p>' +
      '<p class="res-sub">' + esc([m.y, genresText(m.g)].join(m.y && genresText(m.g) ? ' · ' : '')) + '</p>' +
      '<div class="prov" data-prov="' + m.id + '"><p class="prov-note">Buscando dónde verla…</p></div></div></div>';
  }
  function renderResults() {
    var sig = []; for (var i = 0; i < S.players.length; i++) sig.push((S.players[i].likes || []).length);
    var key = 'res:' + S.room.round + ':' + sig.join(',');
    if (S.screen === 'results' && S.resKey === key) return;
    S.resKey = key; show('results');
    var R = computeResults(), n = R.n, h = '';
    $('resPeople').textContent = n + (n === 1 ? ' persona' : ' personas');
    if (R.full.length) {
      $('resTitle').textContent = R.full.length === 1 ? 'Coincidieron en una película' : 'Coincidieron en ' + R.full.length + ' películas';
      for (var f = 0; f < R.full.length; f++) h += resRow(R.full[f], n, f === 0);
      if (R.partial.length) h += '<div class="section-label"><h2>Casi</h2><small>Las que más votos tuvieron</small></div>';
    } else {
      $('resTitle').textContent = 'No coincidieron en ninguna';
      h += '<p class="lede">' + (R.partial.length ? 'Estas fueron las que más votos tuvieron.' : 'Prueben otra ronda con otros géneros.') + '</p>';
    }
    for (var p = 0; p < R.partial.length; p++) h += resRow(R.partial[p], n, false);
    var sc = $('resScroll'); sc.innerHTML = h; sc.scrollTop = 0;
    var all = R.full.concat(R.partial);
    S.resAutoFocus = true;
    for (var d = 0; d < all.length; d++) loadProviders(all[d].m);
    TP.focus.ensure('[data-action="newRound"]');
  }
  function loadProviders(m) {
    catalog.details(m.id, function (err, d) {
      var slot = document.querySelector('[data-prov="' + m.id + '"]'); if (!slot) return;
      if (err) { slot.innerHTML = '<p class="prov-note">Sin información de plataformas</p>'; return; }
      var pv = QV.catalog.providersOf(d), h = '';
      if (pv.flat.length) {
        for (var i = 0; i < pv.flat.length; i++) {
          var pr = pv.flat[i], desc = TP.apps.describe(pr.provider_name);
          h += '<button class="pbtn" data-focusable data-action="open" data-provider="' + esc(pr.provider_name) + '" data-movie="' + m.id + '">' +
            (pr.logo_path ? '<img src="' + img(pr.logo_path, 'w92') + '" alt="">' : '<span class="nologo">' + esc(desc.label.charAt(0)) + '</span>') +
            'Ver en ' + esc(desc.label) + '</button>';
        }
      } else if (pv.other.length) {
        h += '<p class="prov-note">Solo en renta o compra:</p>';
        for (var k = 0; k < pv.other.length && k < 3; k++) h += '<span class="pbtn static">' + esc(pv.other[k].provider_name) + '</span>';
      } else h += '<p class="prov-note">No está en streaming en México.</p>';
      slot.innerHTML = h;
      /* First "Ver en…" button to appear takes focus, unless the person already started moving. */
      var first = S.resAutoFocus && !S.launchOpen && document.querySelector('.res .pbtn[data-focusable]');
      if (first) { S.resAutoFocus = false; TP.focus.setFocus(first); } else TP.focus.ensure();
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
    TP.focus.setScope(null);
    if (S.lastFocus) TP.focus.setFocus(S.lastFocus); else TP.focus.ensure();
  }

  /* ---------- actions ---------- */
  function playerIds() { var ids = []; for (var i = 0; i < S.players.length; i++) ids.push(S.players[i].id); return ids; }
  var actions = {
    newRoom: function () { closeLaunch(); startRoom(); },
    forceResults: function () { store.updateRoom(S.code, { status: 'results' }, function () { poll(); }); },
    newRound: function () {
      store.resetRound(S.code, playerIds(), { status: 'lobby', deck: null, building: null, round: (S.room.round || 1) + 1 }, function () { poll(); });
    },
    closeLaunch: closeLaunch,
    open: function (el) { openLaunch(el.getAttribute('data-provider'), Number(el.getAttribute('data-movie'))); }
  };
  TP.focus.onActivate(function (el) {
    var a = el.getAttribute('data-action');
    if (a && actions[a]) actions[a](el);
  });

  /* ---------- input: remote control first, pointer as an extra layer ---------- */
  window.addEventListener('keydown', function (e) {
    if (TP.lifecycle.handlePlatformEvent(e)) return;
    var k = TP.keys.normalizeKey(e);
    if (!k) return;
    if (k === 'LEFT' || k === 'RIGHT' || k === 'UP' || k === 'DOWN') { e.preventDefault(); S.resAutoFocus = false; TP.focus.move(k.toLowerCase()); return; }
    if (k === 'OK') { e.preventDefault(); TP.focus.activate(); return; }
    if (k === 'BACK') {
      if (S.launchOpen) { e.preventDefault(); closeLaunch(); return; }   /* one level back inside the app */
      TP.lifecycle.handleRootBack(e);                                     /* root: isolated, empty (R6) */
      return;
    }
    if (k === 'MENU' || k === 'EXIT') { TP.lifecycle.handleMenu(e); }     /* native; never our own exit (R6) */
  });
  TP.focus.enablePointer();

  /* ---------- lifecycle ---------- */
  TP.lifecycle.on('standby', function () { S.standby = true; stopPolling(); TP.debug.log('standby: polling paused'); });
  TP.lifecycle.on('wakeup', function () { S.standby = false; startPolling(); poll(); TP.debug.log('wakeup: polling resumed'); });

  /* ---------- boot ---------- */
  TP.debug.log('boot on ' + TP.device.getModel() + ' @ ' + TP.device.getHdmiResolution() + (DEMO ? ' (demo)' : ''));
  startRoom();
})(window.QV, window.TP);
