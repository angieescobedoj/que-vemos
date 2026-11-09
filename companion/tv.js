/* Companion · TV (STB Totalplay simulada). ES5, sin módulos ni framework.
   Nunca llama sagem.*: todo lo de dispositivo pasa por TP.* (src/platform/totalplay).
   Los celulares escriben comandos en rooms/{code}/players/{pid}; la TV los lee por polling y publica su estado en rooms/{code}. */
(function (CP, TP) {
  'use strict';

  var C = CP.content, store = CP.store;
  var COLORS = ['#7A4CC4', '#E58AC3', '#2F6FE0', '#2F9E62', '#E0A93A'];
  var POLL_IDLE = 2000, POLL_ACTIVE = 600, POLL_GAME = 300, SEEN_MS = 45000;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function now() { return new Date().getTime(); }

  /* ---------------- estado ---------------- */
  var S = {
    code: null, players: [], lastSeq: {}, known: {}, offline: false,
    screen: 'boot', content: null, playing: false, pos: 0, posAt: 0, saved: C.SERIES.saved,
    sceneIdx: -1, songSeq: 0, songAt: 0, query: '', dialog: null, matchStart: 0,
    game: { state: 'idle', endsAt: 0, scores: {}, baskets: {}, stars: [], timer: null, lastSpawn: 0 },
    timer: null, standby: false, lastCmdAt: 0,
    /* v6 · control renovado */
    tvName: tvNameParam(), vol: 30, muted: false, off: false, app: null, channel: 7, bright: 100, audioOnly: false,
    exp: null, menu: false, guide: false, finding: false, lat: 0, sleepAt: 0, movie: null, pong: '', ad: null, offer: null, vsaved: 0, rsaved: 0, recipeSeq: 0, recipeStepIdx: 0
  };
  function tvNameParam() {
    var m = /[?&]tv=([^&#]*)/.exec(location.search), v = '';
    if (m) { try { v = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { v = ''; } }
    v = v.replace(/[<>]/g, '').substring(0, 18);
    return v || 'Sala';
  }

  function curPos() { if (S.content === 'video') return $('vid').currentTime || 0; return S.playing ? S.pos + (now() - S.posAt) / 1000 : S.pos; }
  function dur() { return S.content === 'movie' && S.movie ? S.movie.min * 60 : S.content === 'recipe' ? C.RECIPE.dur : C.SERIES.duration; }
  function setPos(p, playing) { S.pos = Math.max(0, Math.min(dur() - 1, p)); S.posAt = now(); S.playing = playing; }
  function vod() { return S.content === 'series' || S.content === 'movie' || S.content === 'recipe'; }
  function playerName(pid) { for (var i = 0; i < S.players.length; i++) if (S.players[i].id === pid) return S.players[i].name || 'Alguien'; return 'Alguien'; }
  function playerIndex(pid) { for (var i = 0; i < S.players.length; i++) if (S.players[i].id === pid) return i; return 0; }
  function connected() { var out = [], t = now(); for (var i = 0; i < S.players.length; i++) if (t - (S.players[i].seen || 0) < SEEN_MS) out.push(S.players[i]); return out; }

  /* ---------------- toasts ---------------- */
  function toast(text, ms) {
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
    var box = $('toasts'); box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms || 4200);
  }

  /* ---------------- publicar estado a los celulares (con coalescencia) ---------------- */
  var pushTimer = null, pushing = false, pushAgain = false, lastPushed = '';
  function gameColors() { var out = {}; for (var i = 0; i < S.players.length; i++) out[S.players[i].id] = COLORS[i % COLORS.length]; return out; }
  function snapshot() {
    var g = S.game, scores = {};
    for (var k in g.scores) if (g.scores.hasOwnProperty(k)) scores[k] = g.scores[k];
    return {
      kind: 'companion', screen: S.screen, content: S.content, playing: S.playing, pos: Math.round(curPos()), posAt: now(),
      saved: Math.round(S.saved), sceneIdx: S.sceneIdx, songSeq: S.songSeq, query: S.query, dialog: S.dialog || '',
      matchStart: S.matchStart, game: { state: g.state, endsAt: g.endsAt, scores: scores, colors: gameColors() },
      tvName: S.tvName, vol: S.vol, muted: S.muted, off: S.off, app: S.app || '', channel: S.channel, bright: S.bright,
      audioOnly: S.audioOnly, exp: S.exp || '', movie: S.content === 'movie' && S.movie ? { t: S.movie.title, app: S.movie.app || '', label: S.movie.label || '', dur: S.movie.min * 60, art: S.movie.art } : null, menu: S.menu, finding: S.finding, tvLat: S.lat, aliveAt: now(), pong: S.pong, ad: S.ad, offer: S.offer, vsaved: Math.round(S.vsaved), recipeSeq: S.recipeSeq || 0, recipeStep: S.recipeStepIdx || 0,
      ship: { state: SH.state, endsAt: SH.endsAt, left: SH.left, scores: shipScores(), colors: gameColors() }, sleepLeft: S.sleepAt ? Math.max(1, Math.ceil((S.sleepAt - now()) / 60000)) : 0
    };
  }
  function pushState() {
    if (!S.code) return;
    if (pushing) { pushAgain = true; return; }
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var snap = snapshot(), cmp = JSON.stringify([snap.screen, snap.content, snap.playing, Math.round(snap.pos / 5), snap.saved, snap.sceneIdx, snap.songSeq, snap.query, snap.dialog, snap.game,
        snap.vol, snap.muted, snap.movie && snap.movie.t, snap.off, snap.app, snap.channel, snap.bright, snap.audioOnly, snap.exp, snap.menu, snap.finding, snap.pong, snap.sleepLeft, snap.ad && snap.ad.seq, snap.offer && snap.offer.seq, snap.ship, snap.recipeSeq, snap.recipeStep]);
      if (cmp === lastPushed) return;
      pushing = true;
      store.updateRoom(S.code, snap, function (err) {
        pushing = false;
        if (!err) lastPushed = cmp; else TP.debug.log('updateRoom: ' + err.message);
        if (pushAgain) { pushAgain = false; pushState(); }
      });
    }, 250);
  }

  /* ---------------- pantallas ---------------- */
  function show(name) {
    if (name !== 'player') stopVideo();
    if (S.screen === 'ship' && name !== 'ship') stopShip();
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) list[i].hidden = list[i].getAttribute('data-screen') !== name;
    S.screen = name;
    if (name !== 'app') S.app = null;
    TP.focus.setScope(null);
    TP.focus.setFocus(null);
    if (name === 'home') TP.focus.ensure('[data-id="series"]');
    if (name === 'search') TP.focus.ensure();
    pushState();
  }

  /* --- inicio --- */
  function artFor(item) {
    if (item.id === 'match') return 'background:url(' + C.PHOTOS.match + '640) center/cover no-repeat,repeating-linear-gradient(90deg,#2E7D49 0 12%,#2A7243 12% 24%)';
    if (item.id === 'series' && SIN.backdrops.length) return 'background:#000 url(' + QV.catalog.img(SIN.backdrops[0], 'w780') + ') center/cover no-repeat';
    if (item.id === 'series' || item.id === 'bunny') { if (item.id === 'bunny') return 'background:#000 url(' + C.BUNNY.poster + ') center/cover no-repeat'; var a = C.SERIES.scenes[0].art; return 'background:linear-gradient(150deg,' + a[0] + ',' + a[1] + ' 60%,' + a[2] + ')'; }
    if (item.id === 'swipe') return 'background:radial-gradient(45% 55% at 30% 40%,rgba(243,139,201,.75) 0%,rgba(243,139,201,0) 70%),radial-gradient(45% 55% at 75% 60%,rgba(84,112,214,.8) 0%,rgba(84,112,214,0) 70%),linear-gradient(150deg,#1B1E3A,#0B0C12)';
    if (item.id === 'bunny') return 'background:#000 url(' + C.BUNNY.poster + ') center/cover no-repeat';
    if (item.id === 'ship') return 'background:radial-gradient(1.5px 1.5px at 25% 30%,#fff 50%,rgba(255,255,255,0) 51%),radial-gradient(1.5px 1.5px at 70% 25%,#fff 50%,rgba(255,255,255,0) 51%),radial-gradient(35% 35% at 70% 75%,rgba(127,214,255,.45) 0%,rgba(127,214,255,0) 70%),linear-gradient(180deg,#070512,#2A1E60)';
    if (item.id === 'recipe') return 'background:url(' + C.PHOTOS.recipe + '640) center/cover no-repeat,radial-gradient(40% 45% at 72% 40%,rgba(255,196,92,.55) 0%,rgba(255,196,92,0) 70%),linear-gradient(150deg,#3E7A3A 0%,#1E3A1C 100%)';
    if (item.id === 'tv') return 'background:linear-gradient(150deg,#3D7BE8,#2E7D49 55%,#3A2160)';
    if (item.id === 'game') return 'background:radial-gradient(40% 40% at 70% 30%,rgba(255,210,122,.6) 0%,rgba(255,210,122,0) 70%),linear-gradient(150deg,#3A2A6E,#120C22)';
    return item.art ? 'background:linear-gradient(150deg,' + item.art[0] + ',' + item.art[1] + ')' : '';
  }
  function tileHtml(item, wide) {
    if (item.kind === 'app') {
      /* Como en un launcher de TV: tarjeta cuadrada que es el ícono oficial completo. Debajo queda el nombre por si el ícono no carga. */
      var logo = CP.logos.img(item.id, 'w185', 't-cover');
      return '<button class="tile app sq' + (logo ? ' has-logo' : '') + '" data-focusable data-action="open" data-id="' + item.id + '" aria-label="' + esc(item.title) + '"' +
        (logo ? '' : ' style="background:' + item.color + '"') + '><span class="t-name">' + esc(item.title) + '</span>' + logo + '</button>';
    }
    if (item.n) {
      var cb = item.tmdb && TMDB[item.tmdb] && TMDB[item.tmdb].backdrop;
      return '<button class="tile sm" data-focusable data-action="channel" data-id="ch' + item.n + '" data-n="' + item.n + '"><span class="t-art" style="' + (cb ? 'background:#000 url(' + QV.catalog.img(cb, 'w300') + ') center/cover no-repeat' : 'background:linear-gradient(150deg,' + item.art[0] + ',' + item.art[1] + ')') + '"></span><span class="t-shade"></span>' +
        '<span class="t-num">' + item.n + '</span>' +
        '<span class="t-body"><span class="t-tag t-red">● En vivo</span><span class="t-title" style="display:block">' + esc(item.name.replace(/ \d+$/, '')) + '</span></span></button>';
    }
    var extra = '';
    if (item.id === 'series') extra = '<div class="t-prog"><i style="width:' + Math.round(S.saved / C.SERIES.duration * 100) + '%"></i></div>';
    if (item.id === 'recipe') extra = '' + (S.rsaved > 1 ? '<div class="t-prog"><i style="width:' + Math.round(S.rsaved / C.RECIPE.dur * 100) + '%"></i></div>' : '');
    if (item.id === 'bunny' && S.vsaved > 1) extra = '<div class="t-prog"><i style="width:' + Math.round(S.vsaved / C.BUNNY.dur * 100) + '%"></i></div>';
    var sub = item.id === 'series' ? 'Película · quedan ' + C.fmt(C.SERIES.duration - S.saved) : item.id === 'bunny' && S.vsaved > 1 ? 'Corto · quedan ' + C.fmt(C.BUNNY.dur - S.vsaved) : item.sub;
    return '<button class="tile' + (wide ? ' wide' : '') + '" data-focusable data-action="open" data-id="' + item.id + '">' +
      '<span class="t-art" style="' + artFor(item) + '"></span><span class="t-shade"></span>' +
      (item.kind === 'live' ? '<span class="t-live"><span class="live">EN VIVO</span></span>' : '') +
      '<span class="t-body"><span class="t-tag">' + esc(item.id === 'series' ? 'Seguir viendo' : item.tag) + '</span>' +
      '<span class="t-title" style="display:block">' + esc(item.title) + '</span><span class="t-sub" style="display:block">' + esc(sub) + '</span>' + extra + '</span></button>';
  }
  function renderHome() {
    var r1 = '<div><p class="row-h">Para ti</p><div class="row-tiles">' + tileHtml(C.SERIES, true) + tileHtml(C.BUNNY, true) + tileHtml(C.RECIPE, true) + tileHtml(C.MATCH, true) + '</div></div>';
    var chs = ''; for (var i = 0; i < C.CHANNELS.length; i++) chs += tileHtml(C.CHANNELS[i]);
    var r2 = '<div><p class="row-h">Canales en vivo</p><div class="row-tiles">' + chs + '</div></div>';
    var apps = ''; for (var j = 0; j < C.APPS.length; j++) apps += tileHtml(C.APPS[j]);
    var r3 = '<div><p class="row-h">Apps y juegos</p><div class="row-tiles">' + apps + gameTile(C.GAME) + gameTile(C.SHIP) + gameTile(C.SWIPE) + '</div></div>';
    var keep = TP.focus.current(), keepId = keep ? keep.getAttribute('data-id') : null;
    $('rows').innerHTML = r1 + r2 + r3;
    if (S.screen === 'home') { TP.focus.setFocus(null); TP.focus.ensure(keepId ? '[data-id="' + keepId + '"]' : '[data-id="series"]'); }
  }
  function gameTile(item) {
    return '<button class="tile sm" data-focusable data-action="open" data-id="' + item.id + '"><span class="t-art" style="' + artFor(item) + '"></span><span class="t-shade"></span>' +
      '<span class="t-body"><span class="t-tag">Juego</span><span class="t-title" style="display:block">' + esc(item.title) + '</span></span></button>';
  }
  function renderPairing() {
    var on = connected(), chip = $('phonesChip');
    chip.textContent = on.length ? (on.length === 1 ? '1 celular vinculado' : on.length + ' celulares vinculados') : 'Sin celulares vinculados';
    chip.className = 'chip' + (on.length ? ' on' : '');
    var html = '';
    for (var i = 0; i < on.length; i++) html += '<li><span class="av" style="background:' + COLORS[playerIndex(on[i].id) % COLORS.length] + '">' + esc((on[i].name || '?').charAt(0).toUpperCase()) + '</span>' + esc(on[i].name || 'Invitado') + '</li>';
    $('pairList').innerHTML = html;
  }

  /* --- búsqueda (B1) --- */
  function renderSearch() {
    $('searchQ').textContent = S.query;
    var q = S.query.toLowerCase().replace(/^\s+|\s+$/g, ''), items = C.all(), html = '', n = 0;
    for (var i = 0; i < items.length; i++) {
      var hay = (items[i].title + ' ' + items[i].sub + ' ' + items[i].tag).toLowerCase();
      if (!q || hay.indexOf(q) >= 0) { html += tileHtml(items[i]); n++; }
    }
    for (var c = 0; c < C.CHANNELS.length; c++) {
      var ch = C.CHANNELS[c], hc = ('canal ' + ch.n + ' ' + ch.name + ' ' + ch.show).toLowerCase();
      if (q && hc.indexOf(q) >= 0) { html += tileHtml(ch); n++; }
    }
    $('searchResults').innerHTML = html;
    $('searchEmpty').hidden = n > 0;
    if (S.screen === 'search') { TP.focus.setFocus(null); TP.focus.ensure(); }
  }

  /* --- reproductor --- */
  function openContent(id, from) {
    var item = C.byId(id);
    if (!item) return;
    if (id === 'game') { startGame(); return; }
    if (id === 'swipe') { launchSwipe(); return; }
    if (id === 'ship') { startShip(); return; }
    if (id === 'bunny') { playBunny(from === 'start'); return; }
    if (id === 'recipe') { playRecipe(); return; }
    if (item.kind === 'app') { openApp(id); return; }
    if (id === 'tv') { tune(S.channel); return; }
    if (id === 'match') { openMatch(); return; }
    closeOverlays();
    if (id === 'series') {
      if (!from && S.saved > 60) { openResume(); return; }
      setPos(from === 'start' ? 0 : (from === 'resume' ? S.saved : 0), true);
      S.sceneIdx = -1;
    }
    S.content = id;
    $('pausePanel').hidden = true;
    show('player');
    paintPlayer();
    if (from === 'resume') toast('Continuando donde lo dejaste · ' + C.fmt(S.saved));
  }
  /* --- TV en vivo: los canales se recorren con ▲▼ del control (o del celular) y OK abre la guía --- */
  var chTimer = null;
  function tune(n) {
    var ch = C.channel(n); if (!ch) return;
    closeOverlays(); stopVideo(); S.offer = null;
    if (S.screen === 'game') stopGame();
    if (S.screen === 'player' && S.content === 'series') { S.saved = curPos(); }
    S.channel = n; S.content = 'live'; S.playing = true;
    $('pausePanel').hidden = true;
    if (S.screen !== 'player') show('player'); else pushState();
    paintPlayer(); showChBanner();
  }
  /* El partido: evento en vivo propio (no es canal). ▲▼ desde aquí llevan a los canales. */
  function openMatch() {
    closeOverlays(); stopVideo(); S.offer = null;
    if (S.screen === 'game') stopGame();
    if (S.screen === 'player' && S.content === 'series') { S.saved = curPos(); }
    S.content = 'match'; S.playing = true;
    if (!S.matchStart) S.matchStart = now();
    $('pausePanel').hidden = true;
    if (S.screen !== 'player') show('player'); else pushState();
    paintPlayer();
  }
  function stepChannel(d) {
    var list = C.CHANNELS, i = 0;
    for (var k = 0; k < list.length; k++) if (list[k].n === S.channel) i = k;
    tune(list[(i + d + list.length) % list.length].n);
  }
  function showChBanner() {
    var ch = C.channel(S.channel), b = $('chBanner'); if (!ch) return;
    b.innerHTML = '<span class="n">' + ch.n + '</span><div><div class="nm">' + esc(ch.name) + '</div><div class="sh">Ahora: ' + esc(ch.show) + ' · Después: ' + esc(ch.next) + '</div></div>';
    b.hidden = false; clearTimeout(chTimer); chTimer = setTimeout(function () { b.hidden = true; }, 4000);
  }
  function openGuide() {
    var html = '';
    for (var i = 0; i < C.CHANNELS.length; i++) {
      var ch = C.CHANNELS[i];
      html += '<button class="g-row' + (ch.n === S.channel ? ' cur' : '') + '" data-focusable data-action="tune" data-n="' + ch.n + '"><span class="n">' + ch.n + '</span><span><span class="nm" style="display:block">' + esc(ch.name) + '</span><span class="sh" style="display:block">' + esc(ch.show) + '</span></span></button>';
    }
    $('guideList').innerHTML = html; $('guide').hidden = false; S.guide = true; $('chBanner').hidden = true;
    TP.focus.setFocus(null); TP.focus.setScope($('guide'), '.g-row.cur');
  }
  function closeGuide() { if (!S.guide) return; S.guide = false; $('guide').hidden = true; TP.focus.setScope(null); }

  /* --- Apps de streaming: la apertura se simula (API de Totalplay pendiente, ver src/platform/totalplay/apps.js) --- */
  var appTimer = null;
  function openApp(id, alt) {
    var a = C.byId(id) || alt; if (!a) return;
    closeOverlays();
    if (S.screen === 'player') { if (S.content === 'series') S.saved = curPos(); S.content = null; S.playing = false; }
    if (S.screen === 'game') stopGame();
    show('app'); S.app = id; pushState();
    $('appAccent').style.background = a.color; $('appName').textContent = a.title; $('appLogo').innerHTML = CP.logos.img(id, 'w185', 'a-logo') || (a.logo ? '<img class="a-logo" src="' + QV.catalog.img(a.logo, 'w185') + '" alt="">' : ''); $('appEyebrow').textContent = 'Abriendo…';
    $('appNote').hidden = true; $('appBtns').hidden = true;
    var pr = $('appProgress'); pr.hidden = false; pr.className = 'app-progress'; setTimeout(function () { pr.className = 'app-progress go'; }, 30);
    clearTimeout(appTimer);
    appTimer = setTimeout(function () {
      if (S.screen !== 'app' || S.app !== id) return;
      pr.hidden = true; $('appEyebrow').textContent = 'Simulación';
      $('appNote').textContent = 'En el decodificador real aquí se abre la app de ' + a.title + ' que ya está instalada. Regresar te trae de vuelta.';
      $('appNote').hidden = false;
      $('appBtns').innerHTML = '<button class="btn ghost" data-focusable data-action="home">Volver al inicio</button>';
      $('appBtns').hidden = false;
      TP.focus.setFocus(null); TP.focus.ensure();
    }, 1300);
  }

  /* --- Menú lateral (☰ en el celular) --- */
  function menuItem(id, label, color) {
    var logo = CP.logos.img(id, 'w92', 'm-logo');
    return '<button class="m-item" data-focusable data-action="menuGo" data-id="' + id + '">' + (logo || (color ? '<span class="sw" style="background:' + color + '"></span>' : '')) + esc(label) + '</button>';
  }
  function openMenu() {
    closeGuide(); closeDialog();
    var html = menuItem('home', 'Inicio') + menuItem('search', 'Buscar') + menuItem('tv', 'TV en vivo') + menuItem('series', 'Seguir viendo') + '<p class="m-h">Apps</p>';
    for (var i = 0; i < C.APPS.length; i++) html += menuItem(C.APPS[i].id, C.APPS[i].title, C.APPS[i].color);
    html += '<p class="m-h">Juegos</p>' + menuItem('game', 'Atrapa estrellas') + menuItem('swipe', '¿Qué vemos?');
    $('menuList').innerHTML = html; $('menu').hidden = false; S.menu = true;
    TP.focus.setFocus(null); TP.focus.setScope($('menu'));
    pushState();
  }
  function closeMenu() { if (!S.menu) return; S.menu = false; $('menu').hidden = true; TP.focus.setScope(null); TP.focus.ensure(); pushState(); }
  function menuGo(id) {
    closeMenu();
    if (id === 'home') goHome();
    else if (id === 'search') openSearch('');
    else openContent(id);
  }
  function closeOverlays() { closeDialog(); closeMenu(); closeGuide(); }
  function openSearch(q) {
    closeOverlays();
    if (S.screen === 'player') leavePlayer();
    if (S.screen === 'game') stopGame();
    S.query = q || ''; if (S.screen !== 'search') show('search'); renderSearch(); pushState();
  }
  function goHome() {
    closeOverlays();
    if (S.screen === 'player') { leavePlayer(); return; }
    if (S.screen === 'game') { exitGame(); return; }
    S.query = ''; show('home'); renderHome();
  }

  /* ================= Seguir viendo · Big Buck Bunny con corte a comerciales ================= */
  var V = { adDone: false, inAd: false, adTimer: null, adTick: null, needSound: false, uiTimer: null, endTimer: null };
  function playerEl() { return document.querySelector('[data-screen="player"]'); }
  function pokeUI() {
    var el = playerEl(); el.className = el.className.replace(/ ?ui-off/g, '');
    clearTimeout(V.uiTimer);
    if (S.content === 'video' && !$('vid').paused) V.uiTimer = setTimeout(function () { if (S.content === 'video' && !$('vid').paused) playerEl().className += ' ui-off'; }, 4000);
  }
  function vidVol() { var v = $('vid'); try { v.volume = Math.max(0, Math.min(1, S.vol / 100)); } catch (e) { /* ignore */ } if (!V.needSound) v.muted = S.muted; }
  function vPlay() {
    var v = $('vid');
    try {
      var pr = v.play();
      if (pr && pr.then) pr.then(function () {}, function () {
        /* el navegador no deja sonar sin una tecla: se reproduce sin sonido y OK lo activa */
        V.needSound = true; v.muted = true;
        try { var p2 = v.play(); if (p2 && p2.then) p2.then(function () {}, function () {}); } catch (e) { /* ignore */ }
        toast('Pulsa OK en el control para activar el sonido', 4000); paintPlayer();
      });
    } catch (e) { /* ignore */ }
  }
  function playBunny(fromStart) {
    var B = C.BUNNY, v = $('vid');
    closeOverlays();
    if (S.screen === 'game') stopGame();
    if (S.screen === 'player' && S.content === 'series') S.saved = curPos();
    if (S.screen === 'player' && S.content === 'movie') S.movie = null;
    var start = fromStart ? 0 : (S.vsaved || 0); if (start > B.dur - 3) start = 0;
    V.adDone = start > B.adAt; V.inAd = false; S.ad = null; $('adBreak').hidden = true;
    S.content = 'video'; S.playing = true; S.posAt = now(); S.pos = start;
    $('pausePanel').hidden = true;
    show('player');
    if (!v.getAttribute('src')) v.setAttribute('src', B.src);
    var seekTo = function () { try { v.currentTime = start; } catch (e) { /* ignore */ } };
    if (v.readyState >= 1) seekTo(); else v.addEventListener('loadedmetadata', function once() { v.removeEventListener('loadedmetadata', once); seekTo(); });
    v.hidden = false; $('vidShade').hidden = false; vidVol(); vPlay();
    paintPlayer(); pokeUI();
    if (start > 1) toast('Continuando donde lo dejaste · ' + C.fmt(start));
  }
  function stopVideo() {
    var v = $('vid'); if (!v) return;
    if (S.content === 'video') { S.vsaved = V.inAd ? Math.max(0, C.BUNNY.adAt - 2) : (v.currentTime || 0); if (V.inAd) V.adDone = false; }
    if (!v.paused) { try { v.pause(); } catch (e) { /* ignore */ } }
    v.hidden = true; $('vidShade').hidden = true;
    endAd(true);
    clearTimeout(V.endTimer);
    var el = playerEl(); el.className = el.className.replace(/ ?ui-off/g, '');
  }
  function vSeek(d) {
    var v = $('vid'), B = C.BUNNY; if (V.inAd) { toast('Es un comercial: la película sigue en un momento', 1800); return; }
    try { v.currentTime = Math.max(0, Math.min(B.dur - 1, (v.currentTime || 0) + d)); } catch (e) { /* ignore */ }
    toast((d > 0 ? 'Adelantar ' : 'Regresar ') + Math.abs(d) + ' s', 1200); pokeUI();
  }
  function startAd() {
    var B = C.BUNNY, v = $('vid');
    V.inAd = true; V.adDone = true;
    try { v.pause(); } catch (e) { /* ignore */ }
    S.ad = { seq: now(), endsAt: now() + B.adSecs * 1000, secs: B.adSecs };
    $('adBreak').hidden = false; pokeUI();
    clearInterval(V.adTick);
    V.adTick = setInterval(function () {
      var left = Math.max(0, Math.ceil((S.ad ? S.ad.endsAt - now() : 0) / 1000));
      $('adLeft').textContent = 'Volvemos en 0:' + (left < 10 ? '0' : '') + left;
      if (left <= 0) { endAd(false); }
    }, 250);
    pushState();
  }
  function endAd(silent) {
    clearInterval(V.adTick);
    if (!V.inAd && !S.ad) return;
    V.inAd = false; S.ad = null; $('adBreak').hidden = true;
    if (!silent && S.content === 'video') { vPlay(); toast('Seguimos con ' + C.BUNNY.title, 2200); }
    pushState();
  }
  (function wireVideo() {
    var v = $('vid');
    function sync() { if (S.content !== 'video') return; S.pos = v.currentTime || 0; S.posAt = now(); S.playing = !v.paused && !V.inAd; pushState(); paintPlayer(); pokeUI(); }
    v.addEventListener('play', sync); v.addEventListener('pause', sync); v.addEventListener('seeked', sync);
    v.addEventListener('timeupdate', function () {
      if (S.content !== 'video') return;
      if (!V.adDone && !V.inAd && v.currentTime >= C.BUNNY.adAt) startAd();
      if (S.screen === 'player') paintPlayer();
    });
    v.addEventListener('ended', function () {
      if (S.content !== 'video') return;
      S.vsaved = 0; V.adDone = false;
      toast('Fin del fragmento · el corto completo dura 10 minutos', 3500);
      clearTimeout(V.endTimer); V.endTimer = setTimeout(function () { if (S.content === 'video' && S.screen === 'player') leavePlayer(); }, 2600);
    });
    v.addEventListener('error', function () { if (S.content === 'video') toast('No se pudo reproducir el video en este equipo', 3500); });
  })();

  /* ================= Recetas: la TV sigue reproduciendo y la lista de compras llega al celular ================= */
  function playRecipe() {
    closeOverlays(); stopVideo(); S.offer = null;
    if (S.screen === 'game') stopGame();
    if (S.screen === 'player' && S.content === 'series') S.saved = curPos();
    var start = S.rsaved > 1 && S.rsaved < C.RECIPE.dur - 5 ? S.rsaved : 0;
    S.content = 'recipe'; S.movie = null; setPos(start, true);
    if (start < C.RECIPE.sendAt) S.recipeSeq = 0;
    $('pausePanel').hidden = true;
    show('player'); paintPlayer();
    if (start) toast('Continuando la receta · paso ' + (C.recipeStep(start) + 1) + ' de ' + C.RECIPE.steps.length);
  }
  function tickRecipe() {
    if (S.content !== 'recipe') return;
    var p = curPos();
    if (!S.recipeSeq && p >= C.RECIPE.sendAt) {
      S.recipeSeq = now(); pushState();
      toast(connected().length ? '📱 Te mandamos la receta y los ingredientes a tu celular' : '📱 Escanea el QR para recibir la receta en tu celular', 4500);
    }
    var st = C.recipeStep(p); if (st !== S.recipeStepIdx) { S.recipeStepIdx = st; pushState(); }
    if (p >= C.RECIPE.dur - 0.5) { S.rsaved = 0; toast('¡Buen provecho! 🍽️', 3000); leavePlayer(); }
  }

  /* ================= Pausa en un canal → sugerencia en el celular (On Demand renta / Anytime) ================= */
  var KEY = 'a7795e812c110c40515e414ceb379fac', TMDB = {};
  function tmdbMovie(id, cb) {
    if (TMDB[id]) { if (TMDB[id].title) cb(TMDB[id]); else TMDB[id].wait.push(cb); return; }
    TMDB[id] = { wait: [cb] };
    QV.http.get('https://api.themoviedb.org/3/movie/' + id + '?api_key=' + KEY + '&language=es-MX', function (err, d) {
      var w = TMDB[id].wait;
      if (err || !d) { delete TMDB[id]; return; }
      TMDB[id] = { title: d.title, overview: d.overview, poster: d.poster_path, backdrop: d.backdrop_path, year: (d.release_date || '').substring(0, 4), runtime: d.runtime, vote: d.vote_average };
      for (var i = 0; i < w.length; i++) { try { w[i](TMDB[id]); } catch (e) { /* ignore */ } }
    });
  }
  /* Los Pecadores: se busca en TMDB y se usan sus fondos (sin texto) para la portada y las escenas */
  var SIN = { backdrops: [], loading: false };
  function loadSinners(cb) {
    if (SIN.backdrops.length || SIN.loading) return; SIN.loading = true;
    QV.http.get('https://api.themoviedb.org/3/search/movie?api_key=' + KEY + '&language=es-MX&query=' + encodeURIComponent(C.SERIES.tmdbQuery) + '&year=' + C.SERIES.tmdbYear, function (err, d) {
      var m = !err && d && d.results && d.results[0];
      if (!m) { SIN.loading = false; return; }
      QV.http.get('https://api.themoviedb.org/3/movie/' + m.id + '/images?api_key=' + KEY + '&include_image_language=null', function (e2, im) {
        var list = (!e2 && im && im.backdrops) || [], out = [];
        for (var i = 0; i < list.length && out.length < 3; i++) if (list[i].file_path) out.push(list[i].file_path);
        if (!out.length && m.backdrop_path) out.push(m.backdrop_path);
        SIN.backdrops = out; SIN.loading = false; if (cb) cb();
      });
    });
  }
  /* Portadas reales para el inicio: Los Pecadores y las películas de los canales */
  function loadCovers() {
    var redraw = function () { if (S.screen === 'home') renderHome(); };
    loadSinners(redraw);
    for (var i = 0; i < C.CHANNELS.length; i++) if (C.CHANNELS[i].tmdb) tmdbMovie(C.CHANNELS[i].tmdb, redraw);
  }
  function sendOffer() {
    var ch = S.content === 'match' ? C.offerSource('match') : C.channel(S.channel); if (!ch || !ch.offer) return;
    S.offer = { seq: now(), ch: ch.n }; pushState();
    if (connected().length) setTimeout(function () { toast('📱 Te enviamos una sugerencia a tu celular', 3500); }, 700);
  }
  var R = { ch: null, info: null };
  function goOffer(n) {
    var ch = C.offerSource(n); if (!ch || !ch.offer) return;
    if (ch.offer.kind !== 'rent' && ch.offer.kind !== 'anytime') return;   /* delivery, datos y Shop pasan en el celular */
    closeOverlays(); S.offer = null;
    if (ch.offer.kind === 'anytime') { playAnytime(ch); return; }
    R.ch = ch; R.info = null;
    if (S.screen === 'player' && S.content === 'series') S.saved = curPos();
    S.content = null; S.playing = false;
    show('rent');
    $('rentTitle').textContent = ch.offer.title; $('rentMeta').textContent = 'On Demand'; $('rentOv').textContent = '';
    $('rentPrice').textContent = 'Renta por 48 horas · $' + ch.offer.price + ' MXN';
    $('rentPoster').style.backgroundImage = ''; $('rentBg').style.background = '#120C1E';
    TP.focus.setFocus(null); TP.focus.ensure('[data-action="rentGo"]');
    tmdbMovie(ch.offer.tmdb, function (m) {
      if (S.screen !== 'rent' || R.ch !== ch) return;
      R.info = m;
      $('rentTitle').textContent = m.title;
      $('rentMeta').textContent = m.year + (m.runtime ? ' · ' + Math.floor(m.runtime / 60) + ' h ' + (m.runtime % 60) + ' min' : '') + (m.vote ? ' · ★ ' + (Math.round(m.vote * 10) / 10) : '');
      $('rentOv').textContent = m.overview || '';
      if (m.poster) $('rentPoster').style.backgroundImage = 'url(' + QV.catalog.img(m.poster, 'w342') + ')';
      if (m.backdrop) $('rentBg').style.background = '#120C1E url(' + QV.catalog.img(m.backdrop, 'w1280') + ') right center/cover no-repeat';
    });
    pushState();
  }
  function rentGo() {
    var ch = R.ch; if (!ch) return;
    var m = R.info || {};
    S.movie = { title: m.title || ch.offer.title, min: m.runtime || 100, art: ch.art, genres: [], label: 'On Demand · rentada', sub: (m.year ? m.year + ' · ' : '') + 'la tienes 48 horas',
      bg: m.backdrop ? QV.catalog.img(m.backdrop, 'w1280') : '' };
    S.content = 'movie'; setPos(0, true);
    show('player'); paintPlayer();
    toast('✓ Rentada · ' + S.movie.title, 3000);
  }
  function playAnytime(ch) {
    stopVideo();
    if (S.screen === 'player' && S.content === 'series') S.saved = curPos();
    var bg = '';
    if (ch.tmdb && TMDB[ch.tmdb] && TMDB[ch.tmdb].backdrop) bg = QV.catalog.img(TMDB[ch.tmdb].backdrop, 'w1280');
    S.movie = { title: ch.offer.title, min: ch.offer.min, art: ch.art, genres: [], label: 'Anytime · desde el inicio', sub: ch.n === 'match' ? 'Se transmitió en vivo' : 'Se transmitió en ' + ch.name, bg: bg };
    S.content = 'movie'; setPos(0, true);
    if (S.screen !== 'player') show('player'); else pushState();
    paintPlayer();
    toast('Anytime · ' + ch.offer.title + ' desde el inicio', 3000);
  }

  /* ================= Nave espacial (el celular se vuelve control clásico) ================= */
  var SH = { state: 'idle', endsAt: 0, left: 0, ships: {}, rocks: [], shots: [], scores: {}, timer: null, lastSpawn: 0 };
  function shipScores() { var o = {}; for (var k in SH.scores) if (SH.scores.hasOwnProperty(k)) o[k] = SH.scores[k]; return o; }
  function newShip(i) { return { x: 25 + i * 17, y: 84, dx: 0, dy: 0, fire: false, b: false, shieldUntil: 0, cool: 0, hitUntil: 0, lastShot: 0 }; }
  function startShip() {
    closeOverlays();
    if (S.screen === 'player' && S.content === 'series') S.saved = curPos();
    if (S.screen === 'game') stopGame();
    S.content = null; S.playing = false;
    clearInterval(SH.timer);
    SH.state = 'running'; SH.endsAt = now() + C.SHIP.seconds * 1000; SH.left = 0; SH.ships = {}; SH.rocks = []; SH.shots = []; SH.scores = {}; SH.lastSpawn = 0;
    var ps = gamePlayers();
    for (var i = 0; i < ps.length; i++) { SH.ships[ps[i].id] = newShip(i); SH.scores[ps[i].id] = 0; }
    $('shipOver').hidden = true; $('shipPaused').hidden = true;
    show('ship');
    SH.timer = setInterval(shipTick, 40);
    toast('¡Despegue! Tu celular ahora es un control clásico', 3200);
    startPolling(); pushState();
  }
  function stopShip() { clearInterval(SH.timer); SH.timer = null; SH.state = 'idle'; $('shipOver').hidden = true; $('shipPaused').hidden = true; }
  function pauseShip() {
    if (SH.state === 'running') { SH.state = 'paused'; SH.left = SH.endsAt - now(); $('shipPaused').hidden = false; }
    else if (SH.state === 'paused') { SH.state = 'running'; SH.endsAt = now() + SH.left; SH.left = 0; $('shipPaused').hidden = true; }
    else if (SH.state === 'over') { startShip(); return; }
    pushState();
  }
  function shipTick() {
    var t = now(), ps = gamePlayers(), i, j;
    for (i = 0; i < ps.length; i++) if (!SH.ships[ps[i].id]) { SH.ships[ps[i].id] = newShip(i); SH.scores[ps[i].id] = SH.scores[ps[i].id] || 0; }
    if (ps.length && ps[0].id !== 'tv' && SH.ships.tv) { delete SH.ships.tv; delete SH.scores.tv; }
    if (SH.state === 'running') {
      for (var id in SH.ships) if (SH.ships.hasOwnProperty(id)) {
        var s = SH.ships[id];
        s.x = Math.max(4, Math.min(96, s.x + s.dx * 1.3)); s.y = Math.max(55, Math.min(90, s.y + s.dy * 1.1));
        if (s.fire && t - s.lastShot > 280) { s.lastShot = t; SH.shots.push({ x: s.x, y: s.y - 5, o: id }); }
      }
      if (t - SH.lastSpawn > 620) { SH.lastSpawn = t; SH.rocks.push({ x: 5 + Math.random() * 90, y: -6, v: 0.45 + Math.random() * 0.65, r: 2.2 + Math.random() * 2.6 }); }
      for (i = SH.shots.length - 1; i >= 0; i--) { SH.shots[i].y -= 2.8; if (SH.shots[i].y < -4) SH.shots.splice(i, 1); }
      for (i = SH.rocks.length - 1; i >= 0; i--) {
        var r = SH.rocks[i], gone = false; r.y += r.v;
        for (j = SH.shots.length - 1; j >= 0 && !gone; j--) {
          var sh = SH.shots[j];
          if (Math.abs(sh.x - r.x) < r.r && Math.abs(sh.y - r.y) < r.r * 1.5) { SH.scores[sh.o] = (SH.scores[sh.o] || 0) + 1; SH.shots.splice(j, 1); gone = true; }
        }
        for (var sid in SH.ships) if (!gone && SH.ships.hasOwnProperty(sid)) {
          var p = SH.ships[sid];
          if (Math.abs(p.x - r.x) < r.r + 1.8 && Math.abs(p.y - r.y) < (r.r + 1.8) * 1.5) {
            if (t < p.shieldUntil) { SH.scores[sid] = (SH.scores[sid] || 0) + 1; gone = true; }
            else if (t > p.hitUntil) { p.hitUntil = t + 1500; SH.scores[sid] = Math.max(0, (SH.scores[sid] || 0) - 2); gone = true; }
          }
        }
        if (gone || r.y > 106) SH.rocks.splice(i, 1);
      }
      if (now() >= SH.endsAt) { endShip(); return; }
    }
    /* pintar */
    var html = '', sc = '';
    for (i = 0; i < SH.rocks.length; i++) { var rk = SH.rocks[i]; html += '<div class="rock" style="left:' + (rk.x - rk.r) + '%;top:' + (rk.y - rk.r * 1.5) + '%;width:' + (rk.r * 2) + '%;height:' + (rk.r * 3) + '%"></div>'; }
    for (i = 0; i < SH.shots.length; i++) html += '<div class="shot" style="left:' + SH.shots[i].x + '%;top:' + SH.shots[i].y + '%"></div>';
    for (i = 0; i < ps.length; i++) {
      var q = SH.ships[ps[i].id]; if (!q) continue;
      html += '<div class="shp' + (t < q.shieldUntil ? ' shield' : '') + (t < q.hitUntil && Math.floor(t / 150) % 2 ? ' hit' : '') + '" style="left:' + q.x + '%;top:' + q.y + '%"><div class="hull" style="border-bottom-color:' + ps[i].color + '"></div><div class="tag">' + esc(ps[i].name.charAt(0).toUpperCase()) + '</div></div>';
      sc += '<div class="g-score"><span class="av" style="background:' + ps[i].color + '">' + esc(ps[i].name.charAt(0).toUpperCase()) + '</span>' + esc(ps[i].name) + '<span class="pts">' + (SH.scores[ps[i].id] || 0) + '</span></div>';
    }
    $('shipStage').innerHTML = html; $('shipScores').innerHTML = sc;
    var left = Math.max(0, Math.ceil((SH.state === 'paused' ? SH.left : SH.endsAt - t) / 1000));
    $('shipTime').textContent = left + ' s';
    if (t % 1000 < 40) pushState();
  }
  function endShip() {
    SH.state = 'over'; clearInterval(SH.timer); SH.timer = null;
    var ps = gamePlayers(), best = null;
    for (var i = 0; i < ps.length; i++) if (!best || (SH.scores[ps[i].id] || 0) > (SH.scores[best.id] || 0)) best = ps[i];
    $('shipWinner').textContent = best ? '¡Ganó ' + best.name + ' con ' + (SH.scores[best.id] || 0) + '!' : 'Fin';
    $('shipOver').hidden = false;
    TP.focus.setFocus(null); TP.focus.setScope($('shipOver'), '[data-action="shipAgain"]');
    pushState();
  }
  function shipInput(pid, c) {
    var s = SH.ships[pid]; if (!s) return;
    s.dx = c.dx || 0; s.dy = c.dy || 0; s.fire = !!c.a;
    if (c.b && !s.b && now() > s.cool) { s.shieldUntil = now() + 2000; s.cool = now() + 6000; }
    s.b = !!c.b;
  }

  /* --- Volumen, brillo, experiencias, reposo, encontrar el control --- */
  var volTimer = null;
  function showVol() {
    $('volIc').textContent = S.muted || !S.vol ? '🔇' : '🔊';
    $('volBar').style.width = (S.muted ? 0 : S.vol) + '%'; $('volN').textContent = S.muted ? 'Silencio' : S.vol;
    $('volHud').hidden = false; clearTimeout(volTimer); volTimer = setTimeout(function () { $('volHud').hidden = true; }, 2600);
  }
  function setVol(v) { S.vol = Math.max(0, Math.min(100, Math.round(v))); S.muted = false; showVol(); musicVol(); pushState(); }
  function applyLook() {
    $('dim').style.opacity = String(Math.round((100 - S.bright) * 0.0075 * 100) / 100);
    $('audioOnly').hidden = !S.audioOnly;
    if (S.audioOnly && !S.off) startMusic(); else stopMusic();
    var chip = $('expChip'); chip.hidden = !S.exp; chip.textContent = S.exp ? '✨ ' + S.exp + sleepTxt() : '';
    if ($('xChip')) $('xChip').textContent = S.exp ? '✨ ' + S.exp + ' · volumen ' + S.vol + ' · brillo ' + S.bright + '%' + sleepTxt() : '';
  }
  function applyExperience(c, who) {
    if (c.id === 'none') { S.exp = null; S.bright = 100; S.audioOnly = false; S.sleepAt = 0; applyLook(); toast(who + ' quitó la experiencia'); if (S.screen === 'exp') goHome(); pushState(); return; }
    S.exp = c.name || 'Experiencia';
    if (typeof c.vol === 'number') setVol(c.vol);
    S.bright = Math.max(10, Math.min(100, c.bright || 100));
    S.audioOnly = !!c.audio;
    S.sleepAt = c.sleep > 0 ? now() + c.sleep * 60000 : 0;
    applyLook();
    if (c.sleep === -1) openSleep();
    if (c.id === 'movies') openExpScreen('movies', c, c.who);
    else if (c.id === 'gaming') openExpScreen('gaming', c, c.who);
    else if (c.sleep !== -1) toast('✨ ' + S.exp + ' · volumen ' + S.vol + ' · brillo ' + S.bright + '%' + sleepTxt(), 4200);
    pushState();
  }
  /* --- Modo noche: el apagado se elige en la TV (este diálogo) o en el celular, lo que pase primero --- */
  var SLEEP_OPTS = [15, 30, 45, 60, 90, 0];
  function openSleep() {
    var html = '';
    for (var i = 0; i < SLEEP_OPTS.length; i++) html += '<button class="btn ghost" data-focusable data-action="sleep" data-min="' + SLEEP_OPTS[i] + '">' + (SLEEP_OPTS[i] ? SLEEP_OPTS[i] + ' min' : 'No apagar') + '</button>';
    html += '<button class="btn ghost" data-focusable data-action="sleepCustom">Otro tiempo…</button>';
    $('sleepOpts').className = 'sleep-opts'; $('sleepOpts').innerHTML = html; closeMenu(); closeGuide();
    S.dialog = 'sleep'; $('sleepDlg').hidden = false;
    TP.focus.setFocus(null); TP.focus.setScope($('sleepDlg'), '[data-min="30"]');
    pushState();
  }
  /* "Otro tiempo": − / + de 5 en 5 minutos con el control */
  var sleepCustom = 25;
  function fmtMin(m) { return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  function openSleepCustom() {
    $('sleepOpts').className = 'sleep-opts col';
    $('sleepOpts').innerHTML = '<div class="sleep-step"><button class="btn ghost" data-focusable data-action="sleepStep" data-d="-5">−</button>' +
      '<span class="sleep-val" id="sleepVal">' + fmtMin(sleepCustom) + '</span><button class="btn ghost" data-focusable data-action="sleepStep" data-d="5">+</button></div>' +
      '<button class="btn" data-focusable data-action="sleep" data-min="' + sleepCustom + '" id="sleepOk">Apagar en ' + fmtMin(sleepCustom) + '</button>' +
      '<button class="btn ghost" data-focusable data-action="sleepBack">Volver</button>';
    TP.focus.setFocus(null); TP.focus.setScope($('sleepDlg'), '[data-d="5"]');
  }
  function stepSleep(d) {
    sleepCustom = Math.max(5, Math.min(300, sleepCustom + d));
    $('sleepVal').textContent = fmtMin(sleepCustom); $('sleepOk').setAttribute('data-min', sleepCustom); $('sleepOk').textContent = 'Apagar en ' + fmtMin(sleepCustom);
  }
  function setSleep(min, who) {
    S.sleepAt = min > 0 ? now() + min * 60000 : 0;
    if (S.dialog === 'sleep') closeDialog();
    applyLook();
    toast(min > 0 ? '🌙 La TV se apagará en ' + fmtMin(min) + (who ? ' · lo eligió ' + who : '') : 'Sin apagado automático', 3500);
    pushState();
  }

  /* --- Solo escuchar: música de fondo (audio/ambient.mp3, compuesta para este prototipo, sin derechos de terceros).
     Se usa un <audio> normal porque varios STB no traen Web Audio. Si el navegador bloquea el sonido hasta que alguien
     toque la pantalla, la TV lo dice y basta con OK en el control para que empiece. */
  var bgm = null, bgmBlocked = false, bgmPrimed = false;
  function bgmEl() {
    if (!bgm) {
      bgm = document.createElement('audio'); bgm.src = 'audio/ambient.mp3?v=1'; bgm.loop = true; bgm.preload = 'auto';
      bgm.addEventListener('ended', function () { try { bgm.currentTime = 0; bgm.play(); } catch (e) { /* ignore */ } });
      document.body.appendChild(bgm);
    }
    return bgm;
  }
  function musicVol() { if (bgm) bgm.volume = S.muted ? 0 : Math.max(0, Math.min(1, S.vol / 100)); }
  function musicHint(blocked) {
    bgmBlocked = blocked;
    $('audioWhat').textContent = blocked ? 'Pulsa OK en el control de la TV para escuchar la música' : 'Pantalla apagada · pulsa cualquier botón para encenderla';
  }
  function startMusic() {
    var a = bgmEl(); a.muted = false; musicVol();
    try {
      var pr = a.play();
      if (pr && pr.then) pr.then(function () { musicHint(false); }, function (err) { musicHint(true); TP.debug.log('bgm: ' + (err && err.name)); });
      else musicHint(false);
    } catch (e) { musicHint(true); }
  }
  function stopMusic() { if (bgm) { try { bgm.pause(); } catch (e) { /* ignore */ } } }
  /* Primera tecla del control: "desbloquea" el audio para que después pueda sonar aunque la orden venga del celular. */
  function primeAudio() {
    if (bgmPrimed) return; bgmPrimed = true;
    var a = bgmEl();
    if (S.audioOnly) { startMusic(); return; }
    try { a.muted = true; var pr = a.play(); if (pr && pr.then) pr.then(function () { if (!S.audioOnly) a.pause(); a.muted = false; }, function () { a.muted = false; bgmPrimed = false; }); } catch (e) { a.muted = false; }
  }

  function sleepTxt() { return S.sleepAt ? ' · se apaga en ' + Math.max(1, Math.ceil((S.sleepAt - now()) / 60000)) + ' min' : ''; }

  /* --- Experiencias que cambian la pantalla ---
     Noche de películas: recomendaciones reales de TMDB con los géneros que la persona eligió en su celular.
     Modo gaming: lleva directo a los juegos disponibles. */
  var GN = { 28: 'Acción', 12: 'Aventura', 16: 'Animación', 35: 'Comedia', 80: 'Crimen', 99: 'Documental', 18: 'Drama', 10751: 'Familia', 14: 'Fantasía', 27: 'Terror', 9648: 'Misterio', 10749: 'Romance', 878: 'Ciencia ficción', 53: 'Suspenso' };
  var PROV_APP = { 8: 'netflix', 9: 'prime', 119: 'prime', 192: 'youtube', 188: 'youtube' };
  var X = { kind: null, movies: [], seq: 0, cur: null };
  function joinNames(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1]; }
  function openExpScreen(kind, c, who) {
    closeOverlays();
    if (S.screen === 'player') { if (S.content === 'series') S.saved = curPos(); S.content = null; S.playing = false; }
    if (S.screen === 'game') stopGame();
    X.kind = kind; show('exp'); applyLook();
    var off = '<button class="btn ghost" data-focusable data-action="expOff">Quitar experiencia</button>';
    if (kind === 'gaming') {
      $('xBrand').textContent = 'Modo gaming'; $('xEyebrow').textContent = 'Experiencia · Modo gaming';
      $('xTitle').textContent = '¿A qué jugamos?';
      $('xSub').textContent = 'Cada quien usa su celular como control. Elige con las flechas y OK.';
      $('xRow').innerHTML = gameCard(C.GAME, '1 a 4 jugadores · 45 segundos') + gameCard(C.SHIP, 'Control clásico · 60 segundos') + gameCard(C.SWIPE, '2 o más · encuentren qué ver');
      $('xBtns').innerHTML = off;
      TP.focus.setFocus(null); TP.focus.ensure('.x-game');
      return;
    }
    var genres = (c && c.genres) || [], names = [];
    for (var i = 0; i < genres.length; i++) if (GN[genres[i]]) names.push(GN[genres[i]]);
    $('xBrand').textContent = 'Noche de películas'; $('xEyebrow').textContent = 'Experiencia · Noche de películas';
    $('xTitle').textContent = 'Elegidas para ' + (who || 'ti');
    $('xSub').textContent = names.length ? 'Porque te gusta ' + joinNames(names).toLowerCase() + ' · en streaming en México' : 'Lo más visto en streaming en México';
    $('xRow').innerHTML = '<p class="x-msg">Buscando recomendaciones…</p>';
    $('xBtns').innerHTML = '<button class="btn" data-focusable data-action="open" data-id="swipe">¿No se deciden? Jueguen ¿Qué vemos?</button>' + off;
    TP.focus.setFocus(null); TP.focus.ensure();
    var list = C.recommend(genres, 6), html = '';
    X.movies = list;
    for (var k = 0; k < list.length; k++) {
      var m = list[k];
      html += '<button class="x-poster" data-focusable data-action="movie" data-i="' + k + '">' +
        '<span class="x-art" style="background:radial-gradient(40% 30% at 60% 38%,' + m.art[2] + ' 0%,rgba(0,0,0,0) 70%),linear-gradient(170deg,' + m.art[0] + ' 0%,' + m.art[1] + ' 100%)"></span>' +
        '<span class="x-pt">' + esc(m.title) + '<small>★ ' + m.score + ' · ' + m.year + '</small></span>' +
        '<span class="x-app">' + (CP.logos.img(m.app, 'w92', 'x-applogo') || '') + esc(appTitle(m.app)) + '</span></button>';
    }
    $('xRow').innerHTML = html;
    TP.focus.setFocus(null); TP.focus.ensure('.x-poster');
  }
  function appTitle(id) { var a = C.byId(id); return a ? a.title : ''; }
  /* OK en una recomendación: se "abre" su app y empieza a reproducirse directo */
  var mvTimer = null;
  function playMovie(i) {
    var m = X.movies[i], a = m && C.byId(m.app); if (!m) return;
    closeOverlays();
    show('app'); S.app = m.app; pushState();
    $('appAccent').style.background = a.color; $('appLogo').innerHTML = CP.logos.img(m.app, 'w185', 'a-logo');
    $('appEyebrow').textContent = 'Abriendo en ' + a.title; $('appName').textContent = m.title;
    $('appNote').hidden = true; $('appBtns').hidden = true;
    var pr = $('appProgress'); pr.hidden = false; pr.className = 'app-progress'; setTimeout(function () { pr.className = 'app-progress go'; }, 30);
    clearTimeout(mvTimer); clearTimeout(appTimer);
    mvTimer = setTimeout(function () {
      if (S.screen !== 'app') return;
      S.movie = m; S.content = 'movie'; setPos(0, true);
      show('player'); paintPlayer();
      toast('▶ ' + m.title + ' · ' + a.title, 3000);
    }, 1400);
  }
  function gameCard(item, sub) {
    return '<button class="x-game" data-focusable data-action="open" data-id="' + item.id + '"><span class="t-art" style="' + artFor(item) + '"></span><span class="t-shade"></span>' +
      '<span class="xg-body"><span class="xg-t">' + esc(item.title) + '</span><span class="xg-s">' + esc(sub) + '</span></span></button>';
  }
  function openMovie(i) {
    var m = X.movies[i]; if (!m) return;
    X.cur = m; S.dialog = 'movie';
    $('mvPoster').src = QV.catalog.img(m.poster_path, 'w342');
    $('mvTitle').textContent = m.title;
    $('mvMeta').textContent = (m.release_date || '').substring(0, 4) + ' · ★ ' + (Math.round((m.vote_average || 0) * 10) / 10);
    $('mvOv').textContent = m.overview || '';
    $('mvProvs').innerHTML = '<p class="mv-none">Buscando dónde verla…</p>';
    $('movieDlg').hidden = false;
    TP.focus.setFocus(null); TP.focus.setScope($('movieDlg'));
    pushState();
    QV.catalog.real.details(m.id, function (err, d) {
      if (X.cur !== m || S.dialog !== 'movie') return;
      var pv = err ? { flat: [], other: [] } : QV.catalog.providersOf(d), list = pv.flat.length ? pv.flat : pv.other, html = '';
      for (var j = 0; j < list.length && j < 6; j++) {
        var p = list[j];
        html += '<button class="prov-btn" data-focusable data-action="prov" data-pid="' + p.provider_id + '" data-name="' + esc(p.provider_name) + '" data-logo="' + esc(p.logo_path || '') + '">' +
          (p.logo_path ? '<img src="' + QV.catalog.img(p.logo_path, 'w92') + '" alt="">' : '') + 'Ver en ' + esc(p.provider_name) + '</button>';
      }
      $('mvProvs').innerHTML = html || '<p class="mv-none">Por ahora no está en streaming en México.</p>';
      TP.focus.setFocus(null); TP.focus.setScope($('movieDlg'), '.prov-btn');
    });
  }
  function openProvider(el) {
    var pid = Number(el.getAttribute('data-pid')), app = PROV_APP[pid], name = el.getAttribute('data-name');
    closeDialog();
    if (app) openApp(app);
    else openApp('p' + pid, { title: name, color: '#7A4CC4', logo: el.getAttribute('data-logo') });
  }

  function setOff(off) {
    if (off === S.off) return;
    S.off = off;
    if (off) { closeOverlays(); stopFind(); if (S.screen === 'player') { if (S.content === 'series') setPos(curPos(), false); else S.playing = false; paintPlayer(); } }
    $('standby').hidden = !off;
    applyLook();
    pushState();
  }
  var findTimer = null, beepTimer = null, actx = null;
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination);
      o.start(); setTimeout(function () { try { o.stop(); } catch (e) { /* ignore */ } }, 220);
    } catch (e) { /* sin audio en este navegador */ }
  }
  function startFind() {
    S.finding = true; $('findDlg').hidden = false; beep();
    clearInterval(beepTimer); beepTimer = setInterval(beep, 900);
    clearTimeout(findTimer); findTimer = setTimeout(stopFind, 15000);
    pushState();
  }
  function stopFind() {
    if (!S.finding) return;
    S.finding = false; $('findDlg').hidden = true; clearInterval(beepTimer); clearTimeout(findTimer); pushState();
  }
  var sayTimer = null;
  function showSay(text, reply) {
    var b = $('voiceBubble');
    b.innerHTML = '<span class="mic">🎤</span><div><div class="q">«' + esc(text) + '»</div>' + (reply ? '<div class="a">' + esc(reply) + '</div>' : '') + '</div>';
    b.hidden = false; clearTimeout(sayTimer); sayTimer = setTimeout(function () { b.hidden = true; }, 4500);
  }

  function leavePlayer() {
    if (S.content === 'recipe') { S.rsaved = curPos() >= C.RECIPE.dur - 1 ? 0 : curPos(); S.playing = false; }
    if (S.content === 'video') stopVideo();
    if (S.content === 'series') { S.saved = curPos(); S.playing = false; }
    /* de una película recomendada se regresa a la lista de recomendaciones */
    if (S.content === 'movie' && X.kind === 'movies' && S.exp) { S.content = null; S.movie = null; S.playing = false; show('exp'); TP.focus.ensure('.x-poster'); return; }
    if (S.content === 'movie') S.movie = null;
    S.content = null; S.sceneIdx = -1;
    show('home'); renderHome();
  }
  function togglePause() {
    if (S.content === 'video') { var v = $('vid'); if (V.inAd) return; if (v.paused) vPlay(); else v.pause(); return; }
    if (vod()) setPos(curPos(), !S.playing);
    else { S.playing = !S.playing; if (!S.playing) sendOffer(); else S.offer = null; }
    paintPlayer(); pushState();
    toast(S.playing ? '▶ Reproduciendo' : '❚❚ En pausa', 1500);
  }
  function seek(delta) {
    if (S.content === 'video') { vSeek(delta > 0 ? 10 : -10); return; }
    if (!vod()) { toast(S.screen === 'player' ? 'En vivo no se puede adelantar' : 'No hay nada reproduciéndose', 1800); return; }
    setPos(curPos() + delta, S.playing); paintPlayer(); pushState();
    toast((delta > 0 ? 'Adelantar ' : 'Regresar ') + Math.abs(delta) + ' s', 1500);
  }
  function matchMinute() { return C.MATCH.startMinute + Math.floor((now() - S.matchStart) / 10000); }
  function paintPlayer() {
    var scene = $('scene');
    $('chLogo').hidden = true;
    $('vid').hidden = S.content !== 'video'; $('vidShade').hidden = S.content !== 'video';
    $('recipeCard').hidden = S.content !== 'recipe';
    if (S.content === 'recipe') {
      var RC = C.RECIPE, rp = curPos(), si = C.recipeStep(rp), step = RC.steps[si];
      scene.className = 'scene';
      scene.className = 'scene img';
      scene.style.background = 'linear-gradient(180deg,rgba(10,7,16,.55) 0%,rgba(10,7,16,.25) 40%,rgba(10,7,16,.6) 100%),url(' + C.PHOTOS.recipe + '1600) center/cover no-repeat,linear-gradient(160deg,#3E6A36 0%,#1A2E18 100%)';
      $('pTag').textContent = RC.title + ' · cocina en casa'; $('pTitle').textContent = RC.dish;
      $('pSub').textContent = S.recipeSeq ? '📱 La receta y los ingredientes ya están en tu celular' : 'Receta para 4 personas · 25 min';
      $('scorebug').hidden = true; $('liveStrip').hidden = true; $('pBottom').hidden = false; $('pausePanel').hidden = true;
      $('rcNum').textContent = 'Paso ' + (si + 1) + ' de ' + RC.steps.length; $('rcIc').textContent = step.ic; $('rcT').textContent = step.t; $('rcD').textContent = step.d;
      $('pState').textContent = S.playing ? '▶  Reproduciendo' : '❚❚  Pausado';
      $('pBar').style.width = (rp / RC.dur * 100) + '%';
      $('pPos').textContent = C.fmt(rp); $('pDur').textContent = '-' + C.fmt(RC.dur - rp);
      return;
    }
    if (S.content === 'video') {
      var B = C.BUNNY, vt = $('vid').currentTime || 0, vp = $('vid').paused;
      scene.className = 'scene'; scene.style.background = '#000';
      $('pTag').textContent = 'Seguir viendo · corto animado'; $('pTitle').textContent = B.title;
      $('pSub').textContent = V.needSound ? '🔇 Pulsa OK para activar el sonido' : B.credit;
      $('scorebug').hidden = true; $('liveStrip').hidden = true; $('pBottom').hidden = false; $('pausePanel').hidden = true;
      $('pState').textContent = V.inAd ? 'Comercial' : (vp ? '❚❚  Pausado' : '▶  Reproduciendo');
      $('pBar').style.width = (vt / B.dur * 100) + '%';
      $('pPos').textContent = C.fmt(vt); $('pDur').textContent = '-' + C.fmt(Math.max(0, B.dur - vt));
      return;
    }
    if (S.content === 'live') {
      var ch = C.channel(S.channel);
      var tm = ch.tmdb && TMDB[ch.tmdb] && TMDB[ch.tmdb].backdrop;
      if (ch.tmdb && !TMDB[ch.tmdb]) tmdbMovie(ch.tmdb, function () { if (S.content === 'live' && S.channel === ch.n) paintPlayer(); });
      scene.className = 'scene';
      if (tm) scene.className = 'scene img';
      scene.style.background = tm ? 'linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 65%,rgba(0,0,0,.6) 100%),#000 url(' + QV.catalog.img(tm, 'w1280') + ') center/cover no-repeat'
        : 'linear-gradient(160deg,' + ch.art[0] + ' 0%,' + ch.art[1] + ' 100%)';
      $('pTag').textContent = 'Canal ' + ch.n + ' · ' + ch.name; $('pTitle').textContent = ch.show; $('pSub').textContent = 'A continuación: ' + ch.next;
      $('scorebug').hidden = true; $('pBottom').hidden = true; $('liveStrip').hidden = false; $('pausePanel').hidden = true;
      $('liveMin').textContent = S.playing ? 'Canal ' + ch.n : 'Pausado';
      $('chLogo').innerHTML = '<div class="n">' + ch.n + '</div><div class="nm">' + esc(ch.name) + '</div>'; $('chLogo').hidden = false;
      return;
    }
    if (S.content === 'match') {
      var m = C.MATCH;
      scene.className = 'scene img';
      scene.style.background = 'linear-gradient(180deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 60%,rgba(0,0,0,.65) 100%),url(' + C.PHOTOS.match + '1600) center/cover no-repeat,repeating-linear-gradient(90deg,#2E7D49 0 8%,#2A7243 8% 16%)';
      $('pTag').textContent = 'En vivo · ' + m.sub; $('pTitle').textContent = m.title; $('pSub').textContent = '';
      $('scorebug').hidden = false;
      $('scorebug').innerHTML = '<span class="tm"><span class="sw" style="background:' + m.home.color + '"></span>' + m.home.short + '</span>' + m.score[0] + ' – ' + m.score[1] +
        '<span class="tm">' + m.away.short + '<span class="sw" style="background:' + m.away.color + '"></span></span><span class="min">' + matchMinute() + '\'</span>';
      $('pBottom').hidden = true; $('liveStrip').hidden = false;
      $('liveMin').textContent = S.playing ? 'Minuto ' + matchMinute() : 'Pausado · en vivo en segundo plano';
      $('pausePanel').hidden = true;
      return;
    }
    if (S.content === 'movie') {
      var mv = S.movie, mp = curPos(), names = [];
      for (var gi = 0; gi < mv.genres.length; gi++) names.push(C.GENRE_NAMES[mv.genres[gi]]);
      scene.className = 'scene';
      if (mv.bg) scene.className = 'scene img';
      scene.style.background = mv.bg ? 'linear-gradient(180deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 65%,rgba(0,0,0,.65) 100%),#000 url(' + mv.bg + ') center/cover no-repeat'
        : 'radial-gradient(35% 45% at 65% 40%,' + (mv.art[2] || 'rgba(255,255,255,.2)') + ' 0%,rgba(0,0,0,0) 70%),linear-gradient(170deg,' + mv.art[0] + ' 0%,' + mv.art[1] + ' 100%)';
      $('pTag').textContent = mv.label || ('Película · en ' + appTitle(mv.app)); $('pTitle').textContent = mv.title;
      $('pSub').textContent = mv.label ? (mv.sub || '') : mv.year + ' · ' + names.join(' · ') + ' · ' + mv.min + ' min';
      $('scorebug').hidden = true; $('liveStrip').hidden = true; $('pBottom').hidden = false; $('pausePanel').hidden = true;
      $('pState').textContent = S.playing ? '▶  Reproduciendo' : '❚❚  Pausado';
      $('pBar').style.width = (mp / dur() * 100) + '%';
      $('pPos').textContent = C.fmt(mp); $('pDur').textContent = '-' + C.fmt(dur() - mp);
      return;
    }
    var p = curPos(), idx = C.sceneAt(p), sc = C.SERIES.scenes[idx];
    scene.className = 'scene';
    var sb = SIN.backdrops.length ? SIN.backdrops[idx % SIN.backdrops.length] : '';
    scene.className = sb ? 'scene img' : 'scene';
    scene.style.background = sb ? 'linear-gradient(180deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,0) 60%,rgba(0,0,0,.65) 100%),#000 url(' + QV.catalog.img(sb, 'w1280') + ') center/cover no-repeat'
      : 'linear-gradient(170deg,' + sc.art[0] + ' 0%,' + sc.art[1] + ' 55%,' + sc.art[2] + ' 100%)';
    $('pTag').textContent = C.SERIES.tag + ' · ' + sc.place; $('pTitle').textContent = C.SERIES.title; $('pSub').textContent = C.SERIES.sub;
    $('scorebug').hidden = true; $('liveStrip').hidden = true; $('pBottom').hidden = false;
    $('pState').textContent = S.playing ? '▶  Reproduciendo' : '❚❚  Pausado';
    $('pBar').style.width = (p / C.SERIES.duration * 100) + '%';
    $('pPos').textContent = C.fmt(p); $('pDur').textContent = '-' + C.fmt(C.SERIES.duration - p);
    /* A2 · pausa enriquecida */
    var pp = $('pausePanel');
    if (!S.playing) {
      $('ppPlace').textContent = sc.place;
      var cast = ''; for (var i = 0; i < sc.cast.length; i++) cast += '<div class="pp-item"><span class="pp-dot"></span><span>' + esc(sc.cast[i][0]) + '<small>' + esc(sc.cast[i][1]) + '</small></span></div>';
      $('ppCast').innerHTML = cast;
      $('ppSong').innerHTML = '<div class="pp-item"><span class="pp-dot"></span><span>' + esc(sc.song.t) + '<small>' + esc(sc.song.a) + '</small></span></div>';
      var pr = ''; for (var j = 0; j < sc.products.length; j++) pr += '<div class="pp-item"><span class="pp-dot"></span><span>' + esc(sc.products[j][0]) + '<small>' + esc(sc.products[j][1]) + '</small></span></div>';
      $('ppProd').innerHTML = pr;
      pp.hidden = false;
    } else pp.hidden = true;
  }
  /* A4 · "Está sonando": al entrar a una escena, unos segundos después avisa la canción a TV y celulares. */
  function tickSeries() {
    if (S.screen !== 'player' || S.content !== 'series') return;
    var idx = C.sceneAt(curPos());
    if (idx !== S.sceneIdx) { S.sceneIdx = idx; S.songAt = now() + 5000; pushState(); }
    if (S.songAt && S.playing && now() >= S.songAt) {
      S.songAt = 0; S.songSeq++;
      var sc = C.SERIES.scenes[idx];
      toast('♪ Está sonando «' + sc.song.t + '» · ' + sc.song.a + ' — míralo en tu celular', 6000);
      pushState();
    }
  }

  /* --- ¿Qué vemos? (juego de match de películas, tv.html del mismo repo) ---
     La TV abre el juego; el juego muestra su propio QR y ahí se unen los demás jugadores. */
  function launchSwipe() {
    closeDialog();
    show('boot'); $('bootText').textContent = 'Abriendo ¿Qué vemos?…';
    S.screen = 'swipe'; pushState();
    setTimeout(function () { location.href = '../tv.html?back=companion&cp=' + S.code + (CP.DEMO ? '&demo=1' : '') + TP.lifecycle.returnQuery(); }, 900);
  }

  /* --- B3 · continuar donde lo dejaste --- */
  function openResume() {
    S.dialog = 'resume';
    $('resumeSub').textContent = 'Te quedaste en ' + C.fmt(S.saved) + ' · quedan ' + C.fmt(C.SERIES.duration - S.saved);
    $('resumeBar').style.width = (S.saved / C.SERIES.duration * 100) + '%';
    $('resumeDlg').hidden = false;
    TP.focus.setScope($('resumeDlg'), '[data-action="resume"]');
    pushState();
  }
  function closeDialog() {
    if (!S.dialog) return;
    S.dialog = null; $('resumeDlg').hidden = true; $('movieDlg').hidden = true; $('sleepDlg').hidden = true; TP.focus.setScope(null); TP.focus.ensure(); pushState();
  }

  /* --- C2 · juego: atrapa estrellas --- */
  function gamePlayers() {
    var on = connected(), out = [];
    for (var i = 0; i < on.length; i++) out.push({ id: on[i].id, name: on[i].name || 'Invitado', color: COLORS[playerIndex(on[i].id) % COLORS.length] });
    if (!out.length) out.push({ id: 'tv', name: 'Teclado', color: COLORS[0] });
    return out;
  }
  function startGame() {
    closeOverlays();
    if (S.screen === 'player') { if (S.content === 'series') S.saved = curPos(); S.content = null; S.playing = false; }
    var g = S.game;
    if (g.timer) clearInterval(g.timer);
    g.state = 'running'; g.endsAt = now() + C.GAME.seconds * 1000; g.scores = {}; g.baskets = {}; g.stars = []; g.lastSpawn = 0;
    $('stage').innerHTML = ''; $('gOver').hidden = true;
    show('game');
    var ps = gamePlayers();
    for (var i = 0; i < ps.length; i++) { g.scores[ps[i].id] = 0; g.baskets[ps[i].id] = { x: 20 + i * 20, dir: 0 }; }
    g.timer = setInterval(gameTick, 40);
    toast('¡A jugar! Mueve tu canasta con el celular', 3000);
    startPolling();
  }
  function gameTick() {
    var g = S.game, t = now(), stage = $('stage');
    if (g.state !== 'running') return;
    /* jugadores que se unen a media partida */
    var ps = gamePlayers(), i;
    for (i = 0; i < ps.length; i++) if (!g.baskets[ps[i].id]) { g.baskets[ps[i].id] = { x: 50, dir: 0 }; g.scores[ps[i].id] = g.scores[ps[i].id] || 0; }
    if (ps.length && ps[0].id !== 'tv' && g.baskets.tv) { delete g.baskets.tv; delete g.scores.tv; }
    for (var id in g.baskets) if (g.baskets.hasOwnProperty(id)) { var b = g.baskets[id]; b.x = Math.max(6, Math.min(94, b.x + b.dir * 1.6)); }
    if (t - g.lastSpawn > 650) { g.lastSpawn = t; g.stars.push({ x: 6 + Math.random() * 88, y: -4, v: 0.9 + Math.random() * 0.9 }); }
    for (i = g.stars.length - 1; i >= 0; i--) {
      var s = g.stars[i]; s.y += s.v;
      if (s.y >= 86 && s.y <= 94) {
        for (var bid in g.baskets) if (g.baskets.hasOwnProperty(bid) && Math.abs(g.baskets[bid].x - s.x) < 7) { g.scores[bid]++; g.stars.splice(i, 1); s = null; pushState(); break; }
      }
      if (s && s.y > 100) g.stars.splice(i, 1);
    }
    /* pintar */
    var html = '';
    for (i = 0; i < g.stars.length; i++) html += '<div class="star" style="left:' + g.stars[i].x + '%;top:' + g.stars[i].y + '%">★</div>';
    var sc = '';
    for (i = 0; i < ps.length; i++) {
      var bk = g.baskets[ps[i].id]; if (!bk) continue;
      html += '<div class="basket" style="left:' + bk.x + '%;background:' + ps[i].color + '">' + esc(ps[i].name.charAt(0).toUpperCase()) + '</div>';
      sc += '<div class="g-score"><span class="av" style="background:' + ps[i].color + '">' + esc(ps[i].name.charAt(0).toUpperCase()) + '</span>' + esc(ps[i].name) + '<span class="pts">' + (g.scores[ps[i].id] || 0) + '</span></div>';
    }
    stage.innerHTML = html; $('gScores').innerHTML = sc;
    var left = Math.max(0, Math.ceil((g.endsAt - t) / 1000));
    $('gameTime').textContent = left + ' s';
    $('gJoin').hidden = connected().length >= 4;
    if (left <= 0) endGame();
  }
  function endGame() {
    var g = S.game; g.state = 'over'; clearInterval(g.timer); g.timer = null;
    var ps = gamePlayers(), best = null;
    for (var i = 0; i < ps.length; i++) if (!best || (g.scores[ps[i].id] || 0) > (g.scores[best.id] || 0)) best = ps[i];
    $('gWinner').textContent = best ? '¡Ganó ' + best.name + ' con ' + (g.scores[best.id] || 0) + '!' : 'Fin';
    $('gOver').hidden = false;
    TP.focus.setScope($('gOver'), '[data-action="gameAgain"]');
    pushState();
  }
  function stopGame() { var g = S.game; if (g.timer) clearInterval(g.timer); g.timer = null; g.state = 'idle'; $('gOver').hidden = true; }
  function exitGame() { stopGame(); show('home'); renderHome(); }

  /* ---------------- control remoto (teclado del STB o del celular) ---------------- */
  function handleKey(k) {
    if (S.off) { if (k === 'OK' || k === 'POWER') setOff(false); return; }
    if (S.finding) { stopFind(); return; }
    if (S.audioOnly && bgmBlocked && k === 'OK') { startMusic(); return; }
    if (S.audioOnly && k !== 'PLAY' && k !== 'REW' && k !== 'FF') { S.audioOnly = false; applyLook(); pushState(); toast('Pantalla encendida', 1500); return; }
    if (S.menu || S.guide || S.dialog) {
      if (k === 'BACK') { if (S.menu) closeMenu(); else if (S.guide) closeGuide(); else closeDialog(); return; }
      if (k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') { TP.focus.move(k.toLowerCase()); return; }
      if (k === 'OK') { TP.focus.activate(); return; }
      return;
    }
    if (k === 'REW') { seek(-30); return; }
    if (k === 'FF') { seek(30); return; }
    if (S.screen === 'player' && S.content === 'video') {
      pokeUI();
      var vv = $('vid');
      if (V.inAd) { if (k === 'BACK') leavePlayer(); else toast('Es un comercial: la película sigue en un momento', 1800); return; }
      if (k === 'OK' && V.needSound) { V.needSound = false; vv.muted = S.muted; if (vv.paused) vPlay(); toast('🔊 Sonido activado', 1500); paintPlayer(); return; }
      if (k === 'OK' || k === 'PLAY') togglePause();
      else if (k === 'LEFT') vSeek(-10);
      else if (k === 'RIGHT') vSeek(10);
      else if (k === 'BACK') leavePlayer();
      return;
    }
    if (S.screen === 'ship') {
      if (SH.state === 'over') {
        if (k === 'BACK') { goHome(); return; }
        if (k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') TP.focus.move(k.toLowerCase());
        else if (k === 'OK') TP.focus.activate();
        return;
      }
      if (k === 'BACK') { goHome(); return; }
      if (k === 'PLAY') { pauseShip(); return; }
      var ts = SH.ships.tv; if (!ts || SH.state !== 'running') return;
      if (k === 'LEFT') ts.x = Math.max(4, ts.x - 6); else if (k === 'RIGHT') ts.x = Math.min(96, ts.x + 6);
      else if (k === 'UP') ts.y = Math.max(55, ts.y - 5); else if (k === 'DOWN') ts.y = Math.min(90, ts.y + 5);
      else if (k === 'OK') { ts.lastShot = now(); SH.shots.push({ x: ts.x, y: ts.y - 5, o: 'tv' }); }
      return;
    }
    if (S.screen === 'player') {
      if (vod()) {
        if (k === 'OK' || k === 'PLAY') togglePause();
        else if (k === 'LEFT') seek(-30);
        else if (k === 'RIGHT') seek(30);
        else if (k === 'BACK') leavePlayer();
        return;
      }
      if (k === 'UP') stepChannel(1);
      else if (k === 'DOWN') stepChannel(-1);
      else if (k === 'OK') openGuide();
      else if (k === 'PLAY') togglePause();
      else if (k === 'LEFT' || k === 'RIGHT' || k === 'INFO') showChBanner();
      else if (k === 'BACK') leavePlayer();
      return;
    }
    if (k === 'PLAY') { toast('No hay nada reproduciéndose', 1800); return; }
    if (S.screen === 'game') {
      var g = S.game;
      if (g.state === 'running') {
        if (k === 'BACK') { endGame(); return; }
        if (g.baskets.tv && (k === 'LEFT' || k === 'RIGHT')) { g.baskets.tv.x = Math.max(6, Math.min(94, g.baskets.tv.x + (k === 'LEFT' ? -8 : 8))); }
        return;
      }
      if (k === 'BACK') { exitGame(); return; }
    }
    if ((S.screen === 'app' || S.screen === 'exp') && k === 'BACK') { goHome(); return; }
    if (S.screen === 'rent' && k === 'BACK') { if (R.ch) tune(R.ch.n); else goHome(); return; }
    if (S.screen === 'search' && k === 'BACK') { S.query = ''; show('home'); renderHome(); return; }
    if (k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') TP.focus.move(k.toLowerCase());
    else if (k === 'OK') TP.focus.activate();
    /* BACK en la raíz (inicio): vacío a propósito (R6) */
  }
  function atRoot() { return S.screen === 'home' && !S.dialog && !S.menu && !S.guide && !S.finding && !S.off && !S.audioOnly; }

  TP.focus.onActivate(function (el) {
    var a = el.getAttribute('data-action');
    if (a === 'open') openContent(el.getAttribute('data-id'));
    else if (a === 'resume') { closeDialog(); openContent('series', 'resume'); }
    else if (a === 'restart') { closeDialog(); openContent('series', 'start'); }
    else if (a === 'gameAgain') startGame();
    else if (a === 'shipAgain') startShip();
    else if (a === 'rentGo') rentGo();
    else if (a === 'rentBack') { if (R.ch) tune(R.ch.n); else goHome(); }
    else if (a === 'goHome') exitGame();
    else if (a === 'home') goHome();
    else if (a === 'channel' || a === 'tune') tune(Number(el.getAttribute('data-n')));
    else if (a === 'menuGo') menuGo(el.getAttribute('data-id'));
    else if (a === 'movie') playMovie(Number(el.getAttribute('data-i')));
    else if (a === 'closeMovie') closeDialog();
    else if (a === 'prov') openProvider(el);
    else if (a === 'expOff') applyExperience({ id: 'none' }, 'Se');
    else if (a === 'sleep') setSleep(Number(el.getAttribute('data-min')), '');
    else if (a === 'sleepCustom') openSleepCustom();
    else if (a === 'sleepStep') stepSleep(Number(el.getAttribute('data-d')));
    else if (a === 'sleepBack') openSleep();
  });

  /* ---------------- comandos de los celulares ---------------- */
  function applyCommand(p, c) {
    var name = p.name || 'Alguien';
    S.lastCmdAt = now();
    if (c.t === 'power') { setOff(typeof c.on === 'boolean' ? !c.on : !S.off); return; }
    if (S.off) { if (c.t === 'key' && c.k === 'OK') setOff(false); return; }   /* en reposo solo se puede encender */
    if (c.t === 'key') handleKey(c.k);
    else if (c.t === 'search') openSearch(c.q || '');
    else if (c.t === 'open') openContent(c.id, c.from || null);
    else if (c.t === 'app') openContent(c.id);
    else if (c.t === 'channel') tune(Number(c.n));
    else if (c.t === 'chstep') { if (S.screen === 'player' && S.content !== 'series') stepChannel(c.d); else tune(S.channel); }
    else if (c.t === 'pause') { if (S.screen === 'player' && S.playing) togglePause(); }
    else if (c.t === 'play') { if (S.screen === 'player' && !S.playing) togglePause(); }
    else if (c.t === 'home') goHome();
    else if (c.t === 'menu') { if (S.menu) closeMenu(); else openMenu(); }
    else if (c.t === 'vol') { if (typeof c.v === 'number') setVol(c.v); else setVol((S.muted ? S.vol : S.vol) + (c.d || 0)); }
    else if (c.t === 'mute') { S.muted = typeof c.on === 'boolean' ? c.on : !S.muted; showVol(); musicVol(); pushState(); }
    else if (c.t === 'exp') applyExperience(c, name);
    else if (c.t === 'find') { if (c.on === false) stopFind(); else startFind(); }
    else if (c.t === 'say') showSay(c.text || '', c.reply || '');
    else if (c.t === 'sleep') setSleep(Number(c.min) || 0, name);
    else if (c.t === 'ping') { S.pong = c.id || ''; pushState(); }
    else if (c.t === 'diag') toast(name + ' revisó la conexión · la TV responde en ' + (S.lat || '—') + ' ms', 4200);
    else if (c.t === 'pad') { var b = S.game.baskets[p.id]; if (b) b.dir = c.dir || 0; }
    else if (c.t === 'game') startGame();
    else if (c.t === 'ship') shipInput(p.id, c);
    else if (c.t === 'shipStart') { if (S.screen === 'ship') pauseShip(); else startShip(); }
    else if (c.t === 'offer') goOffer(c.ch === 'match' ? 'match' : Number(c.ch));
    else if (c.t === 'notice') toast(c.text || '', 4500);
    else if (c.t === 'peek') toast(name + ' está viendo ' + (c.what || 'más información') + ' en su celular', 3500);
    else if (c.t === 'save') toast(name + ' guardó «' + c.what + '» en su soundtrack', 3500);
    else if (c.t === 'product') toast(name + ' abrió «' + c.what + '» en su celular', 3500);
  }
  function processPlayers(list) {
    var t = now();
    S.players = list.sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); });
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!S.known[p.id]) {
        S.known[p.id] = true;
        if (t - (p.seen || 0) < SEEN_MS) toast((p.name || 'Alguien') + ' vinculó su celular', 3000);
        if (S.lastSeq[p.id] === undefined) S.lastSeq[p.id] = (p.cmds && p.cmds.length) ? p.cmds[p.cmds.length - 1].seq : 0;
        continue;
      }
      var cmds = p.cmds || [];
      for (var j = 0; j < cmds.length; j++) {
        if (cmds[j] && cmds[j].seq > (S.lastSeq[p.id] || 0)) { S.lastSeq[p.id] = cmds[j].seq; applyCommand(p, cmds[j]); }
      }
    }
    renderPairing();
  }

  /* ---------------- polling ---------------- */
  var polling = false;
  function pollInterval() {
    if (S.screen === 'game' && S.game.state === 'running') return POLL_GAME;
    if (S.screen === 'ship' && SH.state === 'running') return POLL_GAME;
    if (!connected().length && now() - S.lastCmdAt > 60000) return POLL_IDLE;
    return POLL_ACTIVE;
  }
  function startPolling() { stopPolling(); S.timer = setTimeout(function loop() { poll(); S.timer = setTimeout(loop, pollInterval()); }, pollInterval()); }
  function stopPolling() { if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
  function poll() {
    if (!S.code || S.standby || polling) return;
    polling = true;
    var t0 = now();
    store.listPlayers(S.code, function (err, ps) {
      polling = false;
      if (!err) S.lat = S.lat ? Math.round(S.lat * 0.7 + (now() - t0) * 0.3) : now() - t0;
      if (err) {
        S.fails = (S.fails || 0) + 1;
        /* one blip doesn't count: show the banner after 2 failed checks in a row, with the reason */
        if (S.fails >= 2) { S.offline = true; $('netBanner').hidden = false; $('netBanner').textContent = 'Sin conexión con los celulares (' + (err.message || 'error') + '). Reintentando…'; }
        return;
      }
      S.fails = 0;
      if (S.offline) { S.offline = false; $('netBanner').hidden = true; }
      processPlayers(ps || []);
    });
  }

  /* ---------------- sala + QR ---------------- */
  function phoneUrl(code) {
    var base = location.href.replace(/tv\.html.*$/, '').replace(/[?#].*$/, '');
    return base + '?sala=' + code + (CP.DEMO ? '&demo=1' : '');
  }
  function qrHtml(url, sizeRem) {
    var q = qrcode(0, 'M'); q.addData(url); q.make();
    var n = q.getModuleCount(), remPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 28;
    var quiet = 2, m = Math.max(2, Math.floor(remPx * sizeRem / (n + quiet * 2))), html = '';
    for (var r = -quiet; r < n + quiet; r++) {
      html += '<span class="r" style="height:' + m + 'px">';
      for (var c = -quiet; c < n + quiet; c++) {
        var dark = r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
        html += '<span class="' + (dark ? 'd' : '') + '" style="width:' + m + 'px;height:' + m + 'px"></span>';
      }
      html += '</span>';
    }
    return html;
  }
  function renderQR() {
    var url = phoneUrl(S.code);
    $('qr').innerHTML = qrHtml(url, 10);
    $('qr2').innerHTML = qrHtml(url, 7);
  }
  function newCode() {
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  function savedCode() { try { return localStorage.getItem('cp-tv-code' + (CP.DEMO ? '-demo' : '') + (S.tvName !== 'Sala' ? '-' + S.tvName : '')); } catch (e) { return null; } }
  function keepCode(c) { try { localStorage.setItem('cp-tv-code' + (CP.DEMO ? '-demo' : '') + (S.tvName !== 'Sala' ? '-' + S.tvName : ''), c); } catch (e) { /* R4: sin localStorage, sala nueva en cada carga */ } }
  function boot() {
    show('boot'); $('bootText').textContent = 'Preparando la sala…'; $('tvName').textContent = S.tvName;
    var prev = savedCode();
    function create(tries) {
      var code = newCode();
      store.getRoom(code, function (err, existing) {
        if (err) { $('bootText').textContent = 'No se pudo crear la sala. Revisa la conexión.'; setTimeout(boot, 4000); return; }
        if (existing && tries < 6) return create(tries + 1);
        store.createRoom(code, { kind: 'companion', status: 'companion', createdAt: now(), screen: 'home', tvName: S.tvName, aliveAt: now() }, function (err2) {
          if (err2) { $('bootText').textContent = 'No se pudo crear la sala. Revisa la conexión.'; setTimeout(boot, 4000); return; }
          ready(code);
        });
      });
    }
    function ready(code) {
      S.code = code; keepCode(code); renderQR(); show('home'); renderHome(); renderPairing(); startPolling(); poll(); pushState(); loadCovers();
      /* latido: los celulares ven si esta TV está encendida, en reposo o desconectada */
      setInterval(function () { if (!S.standby) store.updateRoom(S.code, { aliveAt: now(), tvLat: S.lat, off: S.off, tvName: S.tvName }, function () {}); }, 20000);
    }
    if (prev) store.getRoom(prev, function (err, room) { if (!err && room && room.kind === 'companion') ready(prev); else create(0); });
    else create(0);
  }

  /* ---------------- reloj y progreso ---------------- */
  setInterval(function () {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    if (S.screen === 'player') { paintPlayer(); tickSeries(); tickRecipe(); }
    if (S.sleepAt) { if (now() >= S.sleepAt) { S.sleepAt = 0; S.exp = null; S.bright = 100; applyLook(); setOff(true); } else if (d.getSeconds() === 0) applyLook(); }
  }, 1000);

  /* ---------------- teclado (control remoto real o del escritorio) ---------------- */
  window.addEventListener('keydown', function (e) {
    if (TP.lifecycle.handlePlatformEvent(e)) return;
    if (actx && actx.state === 'suspended' && actx.resume) { try { actx.resume(); } catch (err) { /* ignore */ } }
    primeAudio();   /* una tecla del control desbloquea el audio */
    var k = TP.keys.normalizeKey(e);
    if (!k) return;
    if (k === 'MENU' || k === 'EXIT') { TP.lifecycle.handleMenu(e); return; }
    if (e.preventDefault) e.preventDefault();
    if (k === 'BACK' && atRoot()) { TP.lifecycle.handleRootBack(e); return; }
    handleKey(k);
  });
  TP.focus.enablePointer();
  TP.lifecycle.on('standby', function () { S.standby = true; stopPolling(); });
  TP.lifecycle.on('wakeup', function () { S.standby = false; startPolling(); poll(); });

  /* cuando llegan los logos de las apps, se repinta lo que los muestra (el foco se conserva) */
  CP.logos.ready(function () { if (S.screen === 'home') renderHome(); if (S.menu) { var f = TP.focus.current(), fid = f && f.getAttribute('data-id'); openMenu(); if (fid) TP.focus.setFocus($('menu').querySelector('[data-id="' + fid + '"]')); } });
  boot();
})(window.CP, window.TP);
