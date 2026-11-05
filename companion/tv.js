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
    timer: null, standby: false, lastCmdAt: 0
  };

  function curPos() { return S.playing ? S.pos + (now() - S.posAt) / 1000 : S.pos; }
  function setPos(p, playing) { S.pos = Math.max(0, Math.min(C.SERIES.duration - 1, p)); S.posAt = now(); S.playing = playing; }
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
      matchStart: S.matchStart, game: { state: g.state, endsAt: g.endsAt, scores: scores, colors: gameColors() }
    };
  }
  function pushState() {
    if (!S.code) return;
    if (pushing) { pushAgain = true; return; }
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var snap = snapshot(), cmp = JSON.stringify([snap.screen, snap.content, snap.playing, Math.round(snap.pos / 5), snap.saved, snap.sceneIdx, snap.songSeq, snap.query, snap.dialog, snap.game]);
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
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) list[i].hidden = list[i].getAttribute('data-screen') !== name;
    S.screen = name;
    TP.focus.setScope(null);
    TP.focus.setFocus(null);
    if (name === 'home') TP.focus.ensure('[data-id="series"]');
    if (name === 'search') TP.focus.ensure();
    pushState();
  }

  /* --- inicio --- */
  function artFor(item) {
    if (item.id === 'match') return 'background:repeating-linear-gradient(90deg,#2E7D49 0 12%,#2A7243 12% 24%)';
    if (item.id === 'series') { var a = C.SERIES.scenes[0].art; return 'background:linear-gradient(150deg,' + a[0] + ',' + a[1] + ' 60%,' + a[2] + ')'; }
    if (item.id === 'swipe') return 'background:radial-gradient(45% 55% at 30% 40%,rgba(243,139,201,.75) 0%,rgba(243,139,201,0) 70%),radial-gradient(45% 55% at 75% 60%,rgba(84,112,214,.8) 0%,rgba(84,112,214,0) 70%),linear-gradient(150deg,#1B1E3A,#0B0C12)';
    if (item.id === 'game') return 'background:radial-gradient(40% 40% at 70% 30%,rgba(255,210,122,.6) 0%,rgba(255,210,122,0) 70%),linear-gradient(150deg,#3A2A6E,#120C22)';
    return 'background:linear-gradient(150deg,' + item.art[0] + ',' + item.art[1] + ')';
  }
  function tileHtml(item, wide) {
    var extra = '';
    if (item.id === 'series') extra = '<div class="t-prog"><i style="width:' + Math.round(S.saved / C.SERIES.duration * 100) + '%"></i></div>';
    var sub = item.id === 'series' ? 'T1 E3 · quedan ' + C.fmt(C.SERIES.duration - S.saved) : item.sub;
    return '<button class="tile' + (wide ? ' wide' : '') + '" data-focusable data-action="open" data-id="' + item.id + '">' +
      '<span class="t-art" style="' + artFor(item) + '"></span><span class="t-shade"></span>' +
      (item.kind === 'live' ? '<span class="t-live"><span class="live">EN VIVO</span></span>' : '') +
      '<span class="t-body"><span class="t-tag">' + esc(item.id === 'series' ? 'Seguir viendo' : item.tag) + '</span>' +
      '<span class="t-title" style="display:block">' + esc(item.title) + '</span><span class="t-sub" style="display:block">' + esc(sub) + '</span>' + extra + '</span></button>';
  }
  function renderHome() {
    var r1 = '<div><p class="row-h">Para ti</p><div class="row-tiles">' + tileHtml(C.SERIES, true) + tileHtml(C.MATCH, true) + '</div></div>';
    var r2 = '<div><p class="row-h">Juegos y estrenos</p><div class="row-tiles">' + tileHtml(C.SWIPE) + tileHtml(C.GAME) + tileHtml(C.EXTRA[0]) + tileHtml(C.EXTRA[1]) + '</div></div>';
    var keep = TP.focus.current(), keepId = keep ? keep.getAttribute('data-id') : null;
    $('rows').innerHTML = r1 + r2;
    if (S.screen === 'home') { TP.focus.setFocus(null); TP.focus.ensure(keepId ? '[data-id="' + keepId + '"]' : '[data-id="series"]'); }
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
    if (item !== C.MATCH && item !== C.SERIES) { toast('Demo: «' + item.title + '» no está disponible en el prototipo'); return; }
    closeDialog();
    if (id === 'series') {
      if (!from && S.saved > 60) { openResume(); return; }
      setPos(from === 'start' ? 0 : (from === 'resume' ? S.saved : 0), true);
      S.sceneIdx = -1;
    } else {
      S.matchStart = now();
      S.playing = true;
    }
    S.content = id;
    $('pausePanel').hidden = true;
    show('player');
    paintPlayer();
    if (from === 'resume') toast('Continuando donde lo dejaste · ' + C.fmt(S.saved));
  }
  function leavePlayer() {
    if (S.content === 'series') { S.saved = curPos(); S.playing = false; }
    S.content = null; S.sceneIdx = -1;
    show('home'); renderHome();
  }
  function togglePause() {
    if (S.content === 'series') setPos(curPos(), !S.playing);
    else S.playing = !S.playing;
    paintPlayer(); pushState();
  }
  function seek(delta) {
    if (S.content !== 'series') return;
    setPos(curPos() + delta, S.playing); paintPlayer(); pushState();
    toast((delta > 0 ? 'Adelantar ' : 'Regresar ') + Math.abs(delta) + ' s', 1500);
  }
  function matchMinute() { return C.MATCH.startMinute + Math.floor((now() - S.matchStart) / 10000); }
  function paintPlayer() {
    var scene = $('scene');
    if (S.content === 'match') {
      var m = C.MATCH;
      scene.className = 'scene pitch'; scene.style.background = '';
      $('pTag').textContent = m.sub; $('pTitle').textContent = m.title; $('pSub').textContent = '';
      $('scorebug').hidden = false;
      $('scorebug').innerHTML = '<span class="tm"><span class="sw" style="background:' + m.home.color + '"></span>' + m.home.short + '</span>' + m.score[0] + ' – ' + m.score[1] +
        '<span class="tm">' + m.away.short + '<span class="sw" style="background:' + m.away.color + '"></span></span><span class="min">' + matchMinute() + '\'</span>';
      $('pBottom').hidden = true; $('liveStrip').hidden = false;
      $('liveMin').textContent = S.playing ? 'Minuto ' + matchMinute() : 'Pausado · en vivo en segundo plano';
      $('pausePanel').hidden = true;
      return;
    }
    var p = curPos(), idx = C.sceneAt(p), sc = C.SERIES.scenes[idx];
    scene.className = 'scene';
    scene.style.background = 'linear-gradient(170deg,' + sc.art[0] + ' 0%,' + sc.art[1] + ' 55%,' + sc.art[2] + ' 100%)';
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
    setTimeout(function () { location.href = '../tv.html?back=companion&cp=' + S.code + (CP.DEMO ? '&demo=1' : ''); }, 900);
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
    S.dialog = null; $('resumeDlg').hidden = true; TP.focus.setScope(null); pushState();
  }

  /* --- C2 · juego: atrapa estrellas --- */
  function gamePlayers() {
    var on = connected(), out = [];
    for (var i = 0; i < on.length; i++) out.push({ id: on[i].id, name: on[i].name || 'Invitado', color: COLORS[playerIndex(on[i].id) % COLORS.length] });
    if (!out.length) out.push({ id: 'tv', name: 'Teclado', color: COLORS[0] });
    return out;
  }
  function startGame() {
    closeDialog();
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
  function exitGame() {
    var g = S.game; if (g.timer) clearInterval(g.timer); g.timer = null; g.state = 'idle';
    $('gOver').hidden = true; show('home'); renderHome();
  }

  /* ---------------- control remoto (teclado del STB o del celular) ---------------- */
  function handleKey(k) {
    if (S.dialog === 'resume') {
      if (k === 'BACK') { closeDialog(); return; }
      if (k === 'LEFT' || k === 'RIGHT') { TP.focus.move(k.toLowerCase()); return; }
      if (k === 'OK') { TP.focus.activate(); return; }
      return;
    }
    if (S.screen === 'player') {
      if (k === 'OK' || k === 'PLAY') togglePause();
      else if (k === 'LEFT') seek(-30);
      else if (k === 'RIGHT') seek(30);
      else if (k === 'BACK') leavePlayer();
      return;
    }
    if (S.screen === 'game') {
      var g = S.game;
      if (g.state === 'running') {
        if (k === 'BACK') { endGame(); return; }
        if (g.baskets.tv && (k === 'LEFT' || k === 'RIGHT')) { g.baskets.tv.x = Math.max(6, Math.min(94, g.baskets.tv.x + (k === 'LEFT' ? -8 : 8))); }
        return;
      }
      if (k === 'BACK') { exitGame(); return; }
    }
    if (S.screen === 'search' && k === 'BACK') { S.query = ''; show('home'); renderHome(); return; }
    if (k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') TP.focus.move(k.toLowerCase());
    else if (k === 'OK') TP.focus.activate();
    /* BACK en la raíz (inicio): vacío a propósito (R6) */
  }

  TP.focus.onActivate(function (el) {
    var a = el.getAttribute('data-action');
    if (a === 'open') openContent(el.getAttribute('data-id'));
    else if (a === 'resume') { closeDialog(); openContent('series', 'resume'); }
    else if (a === 'restart') { closeDialog(); openContent('series', 'start'); }
    else if (a === 'gameAgain') startGame();
    else if (a === 'goHome') exitGame();
  });

  /* ---------------- comandos de los celulares ---------------- */
  function applyCommand(p, c) {
    var name = p.name || 'Alguien';
    S.lastCmdAt = now();
    if (c.t === 'key') handleKey(c.k);
    else if (c.t === 'search') {
      closeDialog();
      if (S.screen === 'player') leavePlayer();
      if (S.screen === 'game') exitGame();
      S.query = c.q || ''; if (S.screen !== 'search') show('search'); renderSearch(); pushState();
    }
    else if (c.t === 'open') openContent(c.id, c.from || null);
    else if (c.t === 'pause') { if (S.screen === 'player' && S.playing) togglePause(); }
    else if (c.t === 'play') { if (S.screen === 'player' && !S.playing) togglePause(); }
    else if (c.t === 'home') { closeDialog(); if (S.screen === 'player') leavePlayer(); else if (S.screen === 'game') exitGame(); else { S.query = ''; show('home'); renderHome(); } }
    else if (c.t === 'pad') { var b = S.game.baskets[p.id]; if (b) b.dir = c.dir || 0; }
    else if (c.t === 'game') startGame();
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
    if (!connected().length && now() - S.lastCmdAt > 60000) return POLL_IDLE;
    return POLL_ACTIVE;
  }
  function startPolling() { stopPolling(); S.timer = setTimeout(function loop() { poll(); S.timer = setTimeout(loop, pollInterval()); }, pollInterval()); }
  function stopPolling() { if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
  function poll() {
    if (!S.code || S.standby || polling) return;
    polling = true;
    store.listPlayers(S.code, function (err, ps) {
      polling = false;
      if (err) { if (!S.offline) { S.offline = true; $('netBanner').hidden = false; } return; }
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
    $('qr').innerHTML = qrHtml(url, 11);
    $('qr2').innerHTML = qrHtml(url, 7);
    $('pairCode').textContent = S.code;
    $('pairUrl').textContent = url.replace(/^https?:\/\//, '');
  }
  function newCode() {
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  function savedCode() { try { return localStorage.getItem('cp-tv-code' + (CP.DEMO ? '-demo' : '')); } catch (e) { return null; } }
  function keepCode(c) { try { localStorage.setItem('cp-tv-code' + (CP.DEMO ? '-demo' : ''), c); } catch (e) { /* R4: sin localStorage, sala nueva en cada carga */ } }
  function boot() {
    show('boot'); $('bootText').textContent = 'Preparando la sala…';
    var prev = savedCode();
    function create(tries) {
      var code = newCode();
      store.getRoom(code, function (err, existing) {
        if (err) { $('bootText').textContent = 'No se pudo crear la sala. Revisa la conexión.'; setTimeout(boot, 4000); return; }
        if (existing && tries < 6) return create(tries + 1);
        store.createRoom(code, { kind: 'companion', status: 'companion', createdAt: now(), screen: 'home' }, function (err2) {
          if (err2) { $('bootText').textContent = 'No se pudo crear la sala. Revisa la conexión.'; setTimeout(boot, 4000); return; }
          ready(code);
        });
      });
    }
    function ready(code) {
      S.code = code; keepCode(code); renderQR(); show('home'); renderHome(); renderPairing(); startPolling(); poll(); pushState();
    }
    if (prev) store.getRoom(prev, function (err, room) { if (!err && room && room.kind === 'companion') ready(prev); else create(0); });
    else create(0);
  }

  /* ---------------- reloj y progreso ---------------- */
  setInterval(function () {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    if (S.screen === 'player') { paintPlayer(); tickSeries(); }
  }, 1000);

  /* ---------------- teclado (control remoto real o del escritorio) ---------------- */
  window.addEventListener('keydown', function (e) {
    if (TP.lifecycle.handlePlatformEvent(e)) return;
    var k = TP.keys.normalizeKey(e);
    if (!k) return;
    if (k === 'MENU' || k === 'EXIT') { TP.lifecycle.handleMenu(e); return; }
    if (e.preventDefault) e.preventDefault();
    if (k === 'BACK' && S.screen === 'home' && !S.dialog) { TP.lifecycle.handleRootBack(e); return; }
    handleKey(k);
  });
  TP.focus.enablePointer();
  TP.lifecycle.on('standby', function () { S.standby = true; stopPolling(); });
  TP.lifecycle.on('wakeup', function () { S.standby = false; startPolling(); poll(); });

  boot();
})(window.CP, window.TP);
