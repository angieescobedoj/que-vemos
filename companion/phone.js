/* Companion · celular: el control de la TV. Lee el estado de la TV (rooms/{code}) y le manda comandos (rooms/{code}/players/{pid}).
   Entrada automática: el QR de la TV trae ?sala=…; sin códigos ni pasos extra. */
(function (CP) {
  'use strict';
  var C = CP.content, store = CP.store;
  var POLL_MS = 900, HEARTBEAT_MS = 15000, ALIVE_MS = 60000, COLORS = ['#7A4CC4', '#E58AC3', '#2F6FE0', '#2F9E62', '#E0A93A'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  var lsJSON = function (k, def) { try { return JSON.parse(ls.get(k) || '') || def; } catch (e) { return def; } };
  /* En modo demo cada pestaña es un "celular" distinto: el id vive en sessionStorage para no compartirse. */
  var idStore = CP.DEMO ? { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } } } : ls;

  var params = new URLSearchParams(location.search);
  var S = { code: (params.get('sala') || ls.get('cp-last-sala' + (CP.DEMO ? '-demo' : '')) || '').toUpperCase(), pid: null, name: '', room: null, tab: 'control', cmds: [], lastSeq: 0,
            writing: false, dirty: false, songSeen: null, seg: 'lineup', peeked: {}, offline: false, myIndex: 0, padDir: 0,
            fake: null, sheet: null, polling: false, hb: null };

  /* Decodificadores del hogar que no existen en la demo: se pueden elegir y "controlar", pero los comandos no llegan a ninguna TV. */
  var FAKES = [
    { name: 'Recámara', state: 'sleep', vol: 20 },
    { name: 'Estudio', state: 'on', vol: 35 },
    { name: 'Terraza', state: 'off', vol: 30 }
  ];
  var STATE_TXT = { on: 'Conectado', sleep: 'En reposo', off: 'Desconectado' };
  var APP_NAMES = { netflix: 'Netflix', prime: 'Prime Video', youtube: 'YouTube' };

  /* ---------- háptica: vibración en Android; en iPhone (iOS 18+) el truco del interruptor nativo ---------- */
  var hapLabel = null;
  function buzz() {
    try {
      if (navigator.vibrate) { navigator.vibrate(14); return; }
      if (!hapLabel) {
        hapLabel = document.createElement('label');
        hapLabel.setAttribute('aria-hidden', 'true');
        hapLabel.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
        var inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
        hapLabel.appendChild(inp); document.body.appendChild(hapLabel);
      }
      hapLabel.click();
    } catch (e) { /* sin háptica */ }
  }

  /* ---------- envío de comandos (cola de los últimos 10, escrituras en serie, reintento) ---------- */
  function nextSeq() { var t = Date.now(); S.lastSeq = t > S.lastSeq ? t : S.lastSeq + 1; return S.lastSeq; }
  function send(cmd) {
    if (S.fake) { fakeCommand(cmd); return; }
    if (!S.pid) return;
    cmd.seq = nextSeq();
    S.cmds.push(cmd); if (S.cmds.length > 10) S.cmds = S.cmds.slice(-10);
    flush();
  }
  var retryTimer = null;
  function flush() {
    if (S.writing) { S.dirty = true; return; }
    S.writing = true; S.dirty = false;
    store.updatePlayer(S.code, S.pid, { cmds: S.cmds, seen: Date.now() }, function (err) {
      S.writing = false;
      setOffline(!!err);
      if (err) { toast('No se pudo ejecutar – reintentando', true); clearTimeout(retryTimer); retryTimer = setTimeout(flush, 1500); return; }
      if (S.dirty) flush();
    });
  }
  function setOffline(off) { if (S.offline !== off) { S.offline = off; renderHeader(); } }
  var toastEl = null, toastTimer = null;
  function toast(t, err) {
    if (!toastEl) { toastEl = document.createElement('div'); document.body.appendChild(toastEl); }
    toastEl.className = 'toast' + (err ? ' err' : ''); toastEl.textContent = t; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  /* ---------- entrada automática ---------- */
  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone'; if (/iPad/.test(ua)) return 'iPad'; if (/Android/.test(ua)) return 'Android';
    return 'Celular';
  }
  function gate(title, sub, spin, retry) {
    $('gate').hidden = false; $('main').hidden = true; $('tabs').hidden = true;
    $('gTitle').textContent = title; $('gSub').textContent = sub || ''; $('gSpin').hidden = !spin; $('gRetry').hidden = !retry;
  }
  $('gRetry').onclick = function () { connect(S.code); };
  function connect(code, quiet) {
    if (!code) { gate('Escanea el QR de tu TV', 'Abre la cámara y apunta al código que aparece en la pantalla de Sala TV. Te conectas solo, sin códigos.', false, false); return; }
    if (!quiet) gate('Conectando con la TV…', '', true, false);
    store.getRoom(code, function (err, room) {
      if (err) { if (quiet) { toast('No pudimos conectar con esa TV', true); return; } gate('Sin conexión', 'Revisa el internet de tu celular e intenta de nuevo.', false, true); return; }
      if (!room || room.kind !== 'companion') { if (quiet) { toast('Esa TV ya no está disponible', true); return; } gate('No encontramos esta TV', 'Vuelve a escanear el código QR que aparece en la pantalla.', false, true); return; }
      S.name = ls.get('cp-name') || deviceName();
      var pid = idStore.get('cp-pid-' + code) || ('p' + Math.random().toString(36).slice(2, 10));
      idStore.set('cp-pid-' + code, pid);
      store.updatePlayer(code, pid, { name: S.name, joinedAt: Date.now(), seen: Date.now(), kind: 'companion', cmds: [] }, function (err2) {
        if (err2) { if (quiet) { toast('No pudimos conectar con esa TV', true); return; } gate('No pudimos conectarte', 'Intenta de nuevo en un momento.', false, true); return; }
        S.code = code; S.pid = pid; S.cmds = []; S.room = room; S.fake = null; S.songSeen = room.songSeq || 0;
        ls.set('cp-last-sala' + (CP.DEMO ? '-demo' : ''), code);
        rememberRoom(code, room.tvName || 'Sala');
        $('gate').hidden = true; $('main').hidden = false; $('tabs').hidden = false;
        render(); startPolling();
        if (!S.hb) S.hb = setInterval(function () { if (S.pid && !S.fake) store.updatePlayer(S.code, S.pid, { seen: Date.now() }, function (e) { setOffline(!!e); }); }, HEARTBEAT_MS);
        if (quiet) toast('Controlando ' + (room.tvName || 'Sala'));
      });
    });
  }
  function rememberRoom(code, name) {
    var list = lsJSON('cp-rooms' + (CP.DEMO ? '-demo' : ''), []), out = [{ code: code, name: name }];
    for (var i = 0; i < list.length; i++) if (list[i].code !== code && list[i].name !== name) out.push(list[i]);
    ls.set('cp-rooms' + (CP.DEMO ? '-demo' : ''), JSON.stringify(out.slice(0, 6)));
  }

  /* ---------- polling del estado de la TV ---------- */
  function startPolling() {
    if (S.polling) return; S.polling = true;
    (function loop() {
      if (S.fake) { setTimeout(loop, POLL_MS); return; }
      var code = S.code;
      store.getRoom(code, function (err, room) {
        setOffline(!!err);
        if (!err && room && code === S.code && !S.fake) { S.room = room; render(); }
        setTimeout(loop, POLL_MS);
      });
    })();
  }

  /* ---------- estado de la TV para el encabezado ---------- */
  function tvState() {
    if (S.fake) return S.fake.state;
    var r = S.room; if (!r || S.offline) return 'off';
    if (r.aliveAt && Date.now() - r.aliveAt > ALIVE_MS && Date.now() - (r.posAt || 0) > ALIVE_MS) return 'off';
    return r.off ? 'sleep' : 'on';
  }
  function renderHeader() {
    if (!S.room && !S.fake) return;
    var st = tvState();
    $('decName').textContent = S.fake ? S.fake.name : (S.room.tvName || 'Sala');
    $('decState').textContent = S.offline && !S.fake ? 'Sin conexión' : (STATE_TXT[st] + (S.fake ? ' · simulado' : ''));
    $('dot').className = 'dot' + (st === 'off' ? ' off' : st === 'sleep' ? ' sleep' : '');
    $('pwr').className = 'pwr' + (st === 'sleep' ? ' sleep' : '');
    var vol = S.fake ? S.fake.vol : (S.room.vol == null ? 30 : S.room.vol), muted = S.fake ? S.fake.muted : S.room.muted;
    $('volLbl').textContent = muted ? 'Silencio' : 'Vol ' + vol;
    $('muteBtn').className = muted ? 'on' : '';
    $('fakeNote').hidden = !S.fake;
    if (S.fake) $('fakeNote').textContent = S.fake.name + ' es un decodificador simulado: los botones responden aquí, pero no hay una TV real detrás. Elige tu TV en el menú de arriba para volver.';
  }
  function renderNow() {
    var r = S.room, el = $('now'), html = '', st = tvState();
    if (S.fake) {
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">' + esc(S.fake.name) + '</div><div class="t">' + (st === 'sleep' ? 'TV en reposo' : 'Inicio') + '</div><div class="s">Decodificador simulado</div></div>';
    } else if (r.off) {
      html = '<span class="thumb" style="background:#000;border:1px solid var(--line)"></span><div><div class="k">En la TV</div><div class="t">TV en reposo</div><div class="s">Toca ⏻ para encenderla</div></div>';
    } else if (r.app) {
      html = '<span class="thumb" style="background:#0B0910;border-top:5px solid ' + appColor(r.app) + '"></span><div><div class="k">En la TV</div><div class="t">' + esc(APP_NAMES[r.app] || 'App') + '</div><div class="s">App abierta · Regresar vuelve al inicio</div></div>';
    } else if (r.screen === 'player' && r.content === 'series') {
      var sc = sceneNow();
      html = '<span class="thumb" style="background:linear-gradient(150deg,' + sc.art[0] + ',' + sc.art[1] + ')"></span><div><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + '</div><div class="t">Marea Alta · T1 E3</div><div class="s">' + C.fmt(pos()) + ' / ' + C.fmt(C.SERIES.duration) + '</div></div>';
    } else if (r.screen === 'player' && r.content === 'movie' && r.movie) {
      var mv = r.movie, mp = r.playing ? r.pos + Math.max(0, (Date.now() - r.posAt) / 1000) : r.pos;
      html = '<span class="thumb" style="background:linear-gradient(170deg,' + mv.art[0] + ',' + mv.art[1] + ')"></span><div><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + ' · ' + esc(APP_NAMES[mv.app] || '') + '</div><div class="t">' + esc(mv.t) + '</div><div class="s">' + C.fmt(mp) + ' / ' + C.fmt(mv.dur) + ' · ⏪ ⏯ ⏩ para controlar</div></div>';
    } else if (r.screen === 'player' && r.content === 'match') {
      html = '<span class="thumb" style="background:repeating-linear-gradient(90deg,#2E7D49 0 12%,#2A7243 12% 24%)"></span><div><div class="k">Canal 7 · en vivo · min ' + matchMinute() + '</div><div class="t">' + C.MATCH.home.name + ' ' + C.MATCH.score[0] + ' – ' + C.MATCH.score[1] + ' ' + C.MATCH.away.name + '</div><div class="s">▲▼ cambian de canal · OK abre la guía</div></div>';
    } else if (r.screen === 'player' && r.content === 'live') {
      var ch = C.channel(r.channel) || C.CHANNELS[0];
      html = '<span class="thumb" style="background:linear-gradient(150deg,' + ch.art[0] + ',' + ch.art[1] + ')"></span><div><div class="k">Canal ' + ch.n + ' · en vivo</div><div class="t">' + esc(ch.show) + '</div><div class="s">▲▼ cambian de canal · OK abre la guía</div></div>';
    } else if (r.screen === 'search') {
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">En la TV</div><div class="t">Buscando “' + esc(r.query) + '”</div><div class="s">Usa las flechas y OK para elegir</div></div>';
    } else if (r.screen === 'swipe') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#F38BC9,#5470D6)"></span><div><div class="k">En la TV</div><div class="t">¿Qué vemos? · match de películas</div><div class="s">Muévete con el control · Regresar vuelve a Sala TV</div></div>';
    } else if (r.screen === 'exp') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#E58AC3,#7A4CC4)"></span><div><div class="k">En la TV · experiencia</div><div class="t">' + esc(r.exp || 'Experiencia') + '</div><div class="s">' + (r.dialog === 'movie' ? 'Elige dónde verla con OK' : 'Elige con las flechas y OK') + '</div></div>';
    } else if (r.screen === 'game') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#3A2A6E,#120C22)"></span><div><div class="k">En la TV</div><div class="t">Atrapa estrellas</div></div>';
    } else {
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">En la TV' + (r.exp ? ' · ✨ ' + esc(r.exp) : '') + '</div><div class="t">' + (r.menu ? 'Menú abierto' : r.dialog === 'resume' ? '¿Continuar Marea Alta?' : 'Inicio') + '</div><div class="s">Navega con las flechas y OK</div></div>';
    }
    el.innerHTML = html;
  }
  function appColor(id) { for (var i = 0; i < C.APPS.length; i++) if (C.APPS[i].id === id) return C.APPS[i].color; return '#7A4CC4'; }

  /* ---------- decodificador simulado: responde con feedback, sin TV detrás ---------- */
  function fakeCommand(cmd) {
    var f = S.fake, n = f.name;
    if (cmd.t === 'say' || cmd.t === 'peek' || cmd.t === 'diag') return;
    if (cmd.t === 'power') { f.state = f.state === 'sleep' ? 'on' : 'sleep'; toast(n + (f.state === 'sleep' ? ' en reposo' : ' encendida') + ' (simulado)'); renderHeader(); renderNow(); return; }
    if (f.state === 'sleep') { toast(n + ' está en reposo · toca ⏻'); return; }
    if (cmd.t === 'vol') { f.vol = Math.max(0, Math.min(100, typeof cmd.v === 'number' ? cmd.v : f.vol + cmd.d)); f.muted = false; toast(n + ' · volumen ' + f.vol + ' (simulado)'); renderHeader(); return; }
    if (cmd.t === 'mute') { f.muted = !f.muted; toast(n + (f.muted ? ' en silencio' : ' con sonido') + ' (simulado)'); renderHeader(); return; }
    if (cmd.t === 'app') { toast('Abriendo ' + APP_NAMES[cmd.id] + ' en ' + n + ' (simulado)'); return; }
    if (cmd.t === 'key') { toast(n + ' · ' + ({ UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', OK: 'OK', BACK: 'Regresar', PLAY: '⏯', REW: '⏪', FF: '⏩' }[cmd.k] || cmd.k) + ' (simulado)'); return; }
    toast('Enviado a ' + n + ' (simulado)');
  }

  /* ---------- helpers de estado ---------- */
  function pos() { var r = S.room; if (!r) return 0; return r.playing ? r.pos + Math.max(0, (Date.now() - r.posAt) / 1000) : r.pos; }
  function matchMinute() { return C.MATCH.startMinute + Math.floor(Math.max(0, Date.now() - (S.room.matchStart || Date.now())) / 10000); }
  function sceneNow() { return C.SERIES.scenes[C.sceneAt(pos())]; }
  function soundtrack() { try { return JSON.parse(ls.get('cp-soundtrack') || '[]'); } catch (e) { return []; } }
  function saveSong(song) {
    var list = soundtrack(), key = song.t + '|' + song.a;
    for (var i = 0; i < list.length; i++) if (list[i].t + '|' + list[i].a === key) { toast('Ya está en tu soundtrack'); return; }
    list.unshift(song); ls.set('cp-soundtrack', JSON.stringify(list.slice(0, 20)));
    send({ t: 'save', what: song.t }); toast('Guardada en tu soundtrack'); render();
  }

  /* ---------- render ---------- */
  function render() {
    var r = S.room; if (!r) return;
    if (S.fake) { renderHeader(); renderNow(); return; }
    renderHeader(); renderNow(); renderGame();
    if (S.tab === 'ahora') renderAhora();
    if (S.tab === 'seguir') renderSeguir();
    /* A4 · aviso de "Está sonando" */
    if (S.songSeen === null) S.songSeen = r.songSeq || 0;
    if ((r.songSeq || 0) > S.songSeen) { S.songSeen = r.songSeq; if (r.content === 'series') showSongBanner(sceneNow().song); }
  }
  function renderAhora() {
    var r = S.room, el = $('ahora'), html = '';
    if (r.screen === 'player' && r.content === 'match') {
      var m = C.MATCH;
      if (!S.peeked[S.seg]) { S.peeked[S.seg] = true; send({ t: 'peek', what: S.seg === 'lineup' ? 'la alineación' : S.seg === 'stats' ? 'las estadísticas' : 'datos del partido' }); }
      html += '<p class="eyebrow">Partido en vivo · minuto ' + matchMinute() + '</p><h2 style="margin-top:4px">' + m.home.name + ' ' + m.score[0] + ' – ' + m.score[1] + ' ' + m.away.name + '</h2>';
      html += '<div class="seg"><button data-seg="lineup"' + (S.seg === 'lineup' ? ' class="on"' : '') + '>Alineación</button><button data-seg="stats"' + (S.seg === 'stats' ? ' class="on"' : '') + '>Estadísticas</button><button data-seg="facts"' + (S.seg === 'facts' ? ' class="on"' : '') + '>Datos</button></div>';
      if (S.seg === 'lineup') {
        html += '<div class="lineup">' + team(m.home, m.lineups.home) + team(m.away, m.lineups.away) + '</div>';
      } else if (S.seg === 'stats') {
        for (var i = 0; i < m.stats.length; i++) {
          var s = m.stats[i], tot = s[1] + s[2];
          html += '<div class="stat"><div class="row"><span>' + s[1] + s[3] + '</span><span class="muted">' + s[0] + '</span><span>' + s[2] + s[3] + '</span></div><div class="bars"><i style="flex:' + s[1] / tot + ';background:' + m.home.color + '"></i><i style="flex:' + s[2] / tot + ';background:' + m.away.color + '"></i></div></div>';
        }
      } else {
        for (var f = 0; f < m.facts.length; f++) html += '<div class="fact">' + esc(m.facts[f]) + '</div>';
      }
      el.innerHTML = html; return;
    }
    if (r.screen === 'player' && r.content === 'series') {
      var sc = sceneNow();
      html += '<p class="eyebrow">En esta escena · ' + esc(sc.place) + '</p><h2 style="margin-top:4px">Marea Alta</h2>';
      html += '<div style="margin-top:12px">' + (r.playing
        ? '<button class="btn" data-act="pause">❚❚  Pausar y descubrir en la TV</button>'
        : '<button class="btn ghost" data-act="play">▶  Seguir viendo</button>') + '</div>';
      html += '<div class="sec"><p class="sec-h">Personajes</p><div class="card">';
      for (var c = 0; c < sc.cast.length; c++) html += '<div class="item"><span class="av">' + esc(sc.cast[c][0].charAt(0)) + '</span><div class="grow"><div class="t">' + esc(sc.cast[c][0]) + '</div><div class="s">Interpretado por ' + esc(sc.cast[c][1]) + '</div></div></div>';
      html += '</div></div>';
      html += '<div class="sec"><p class="sec-h">Está sonando</p><div class="card"><div class="item"><span class="av">♪</span><div class="grow"><div class="t">' + esc(sc.song.t) + '</div><div class="s">' + esc(sc.song.a) + '</div></div><button class="btn sm" data-act="saveSong">Guardar</button></div></div></div>';
      html += '<div class="sec"><p class="sec-h">Productos de la escena</p><div class="card">';
      for (var p = 0; p < sc.products.length; p++) html += '<div class="item"><span class="av">🛍</span><div class="grow"><div class="t">' + esc(sc.products[p][0]) + '</div><div class="s">' + esc(sc.products[p][1]) + '</div></div><button class="btn sm ghost" data-act="product" data-i="' + p + '">Ver</button></div>';
      html += '</div></div>';
      html += soundtrackHtml();
      el.innerHTML = html; return;
    }
    html += '<div class="empty"><p class="eyebrow">Ahora en la TV</p><h2 style="margin-top:6px">Elige algo para ver</h2><p class="muted">Aquí verás información de lo que se está reproduciendo: personajes, canciones, productos o la alineación del partido.</p><div class="stack">' +
      '<button class="btn" data-open="match">Ver el partido en vivo</button><button class="btn ghost" data-open="series" data-from="">Ver Marea Alta</button><button class="btn ghost" data-cmd="game">Jugar Atrapa estrellas</button></div></div>';
    html += soundtrackHtml();
    el.innerHTML = html;
  }
  function team(t, list) {
    var h = '<div class="team"><div class="tn"><span class="sw" style="background:' + t.color + '"></span>' + esc(t.name) + '</div>';
    for (var i = 0; i < list.length; i++) h += '<div class="pl"><b>' + list[i][0] + '</b><span>' + esc(list[i][1]) + '</span><em>' + list[i][2] + '</em></div>';
    return h + '</div>';
  }
  function soundtrackHtml() {
    var list = soundtrack(); if (!list.length) return '';
    var h = '<div class="sec"><p class="sec-h">Tu soundtrack</p><div class="card">';
    for (var i = 0; i < list.length; i++) h += '<div class="item"><span class="av">♪</span><div class="grow"><div class="t">' + esc(list[i].t) + '</div><div class="s">' + esc(list[i].a) + '</div></div></div>';
    return h + '</div></div>';
  }

  function renderSeguir() {
    var r = S.room, sv = C.SERIES, a = sv.scenes[0].art;
    var onTv = r.screen === 'player' && r.content === 'series', p = onTv ? pos() : (r.saved || sv.saved);
    var html = '<p class="eyebrow">Seguir viendo</p><div class="series-card" style="margin-top:8px"><div class="art" style="background:linear-gradient(150deg,' + a[0] + ',' + a[1] + ' 60%,' + a[2] + ')"><span>Marea Alta</span></div><div class="body">' +
      '<div style="font-weight:700">Temporada 1 · Episodio 3</div><div class="muted" style="font-size:13px">La isla</div>' +
      '<div class="prog"><i style="width:' + (p / sv.duration * 100) + '%"></i></div><div class="muted" style="font-size:12px;margin-bottom:14px">' +
      (onTv ? 'Reproduciéndose en la TV · ' + C.fmt(p) : 'Te quedaste en ' + C.fmt(p) + ' · quedan ' + C.fmt(sv.duration - p)) + '</div>' +
      (onTv ? '<button class="btn ghost" data-go="ahora">Ver qué hay en esta escena</button>'
            : '<div class="stack"><button class="btn" data-open="series" data-from="resume">Continuar en la TV</button><button class="btn ghost" data-open="series" data-from="start">Desde el inicio</button></div>') +
      '</div></div>';
    $('seguir').innerHTML = html;
  }

  /* ---------- C2 · gamepad ---------- */
  function renderGame() {
    var r = S.room, g = r.game || {}, inGame = r.screen === 'game' && (g.state === 'running' || g.state === 'over');
    $('game').hidden = !inGame; $('tabs').style.display = inGame ? 'none' : '';
    if (!inGame) { if (S.padDir) setDir(0); return; }
    var scores = g.scores || {}, mine = scores[S.pid] || 0;
    $('gMe').innerHTML = '<span class="av" style="background:' + ((g.colors && g.colors[S.pid]) || COLORS[0]) + '">' + esc((S.name || '?').charAt(0).toUpperCase()) + '</span>' + esc(S.name);
    $('gPts').textContent = mine;
    var left = Math.max(0, Math.ceil(((g.endsAt || 0) - Date.now()) / 1000));
    $('gInfo').textContent = g.state === 'running' ? 'Atrapa estrellas · quedan ' + left + ' s' : 'Fin del juego · hiciste ' + mine + ' puntos';
    $('gPad').hidden = g.state !== 'running'; $('gOver').hidden = g.state !== 'over';
  }
  function setDir(d) {
    if (S.padDir === d) return; S.padDir = d;
    var bs = $('gPad').querySelectorAll('button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', Number(bs[i].getAttribute('data-dir')) === d);
    send({ t: 'pad', dir: d }); if (d) buzz();
  }
  (function () {
    var bs = $('gPad').querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) (function (b) {
      var d = Number(b.getAttribute('data-dir'));
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); setDir(d); });
      b.addEventListener('pointerup', function () { setDir(0); });
      b.addEventListener('pointercancel', function () { setDir(0); });
      b.addEventListener('pointerleave', function () { if (S.padDir === d) setDir(0); });
    })(bs[i]);
  })();

  /* ---------- banner y hoja ---------- */
  var bannerTimer = null;
  function showSongBanner(song) {
    var b = $('banner');
    b.innerHTML = '<span class="ic">♪</span><div><div class="k">Está sonando en la TV</div><div class="t">' + esc(song.t) + '</div><div class="s">' + esc(song.a) + '</div></div><div class="x"><button data-act="saveBanner">Guardar</button><button class="g" data-act="closeBanner">Cerrar</button></div>';
    b.hidden = false; b._song = song; buzz();
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { b.hidden = true; }, 9000);
  }
  function openProduct(prod) {
    $('sheet').innerHTML = '<div class="img"></div><p class="eyebrow" style="color:#7A4CC4">De la escena · Marea Alta</p><h2 style="margin:4px 0 2px">' + esc(prod[0]) + '</h2><p style="color:#555;margin-bottom:16px">' + esc(prod[1]) + ' · Demo: compra no disponible en el prototipo</p><button class="btn" data-act="closeSheet">Listo</button>';
    $('sheet').hidden = false; $('scrim').hidden = false; S.sheet = 'product';
    send({ t: 'product', what: prod[0] });
  }

  /* ---------- hojas (modales): no tapan el control, se cierran deslizando al fondo o con ✕ ---------- */
  function openSheet(name, html) {
    S.sheet = name;
    $('sheet').innerHTML = '<button class="x" data-act="closeSheet" aria-label="Cerrar">✕</button>' + html;
    $('sheet').hidden = false; $('scrim').hidden = false; $('sheet').scrollTop = 0;
  }
  function closeSheet() {
    if (S.sheet === 'voice') stopListening();
    if (S.sheet === 'find' && !S.fake) send({ t: 'find', on: false });
    S.sheet = null; $('sheet').hidden = true; $('scrim').hidden = true;
  }

  /* Decodificadores: las TVs reales que este celular ya escaneó + los simulados del hogar */
  function openDecoders() {
    var rooms = lsJSON('cp-rooms' + (CP.DEMO ? '-demo' : ''), []), html = '<h2>Tus decodificadores</h2><p class="sub">Elige qué TV quieres controlar.</p><div id="decList">';
    var names = {};
    for (var i = 0; i < rooms.length; i++) {
      names[rooms[i].name] = true;
      var cur = !S.fake && rooms[i].code === S.code;
      html += '<button class="opt' + (cur ? ' on' : '') + '" data-room="' + esc(rooms[i].code) + '"><span class="sdot" id="st-' + esc(rooms[i].code) + '"></span><span class="grow"><span class="t">' + esc(rooms[i].name) + '</span><span class="s" id="sx-' + esc(rooms[i].code) + '" style="display:block">Revisando…</span></span>' + (cur ? '<b style="color:#7A4CC4">✓</b>' : '') + '</button>';
    }
    for (var j = 0; j < FAKES.length; j++) {
      var f = FAKES[j]; if (names[f.name]) continue;
      var on = S.fake === f;
      html += '<button class="opt' + (on ? ' on' : '') + '" data-fake="' + j + '"><span class="sdot ' + (f.state === 'on' ? '' : f.state) + '"></span><span class="grow"><span class="t">' + esc(f.name) + '<span class="tag">Simulado</span></span><span class="s" style="display:block">' + STATE_TXT[f.state] + '</span></span>' + (on ? '<b style="color:#7A4CC4">✓</b>' : '') + '</button>';
    }
    html += '</div><p class="sub" style="margin-top:10px">¿Otra TV de la casa? Escanea el QR que aparece en su pantalla y se agrega aquí sola.</p>' +
      '<label class="lf">Apareces en la TV como</label><div class="vform"><input class="in-l" id="nameIn" maxlength="18" value="' + esc(S.name) + '"><button data-act="saveName">Guardar</button></div>';
    openSheet('decoders', html);
    for (var k = 0; k < rooms.length; k++) (function (rm) {
      store.getRoom(rm.code, function (err, room) {
        var sx = $('sx-' + rm.code), sd = $('st-' + rm.code); if (!sx) return;
        var st = 'off';
        if (!err && room) st = (room.aliveAt && Date.now() - room.aliveAt > ALIVE_MS) ? 'off' : (room.off ? 'sleep' : 'on');
        if (!err && !room) { sx.textContent = 'Ya no está disponible'; sd.className = 'sdot off'; return; }
        sx.textContent = err ? 'Sin conexión' : STATE_TXT[st]; sd.className = 'sdot ' + (st === 'on' ? '' : st);
      });
    })(rooms[k]);
  }
  function pickRoom(code) {
    closeSheet();
    if (!S.fake && code === S.code) return;
    S.fake = null; connect(code, true);
  }
  function pickFake(i) {
    var f = FAKES[i];
    if (f.state === 'off') { toast(f.name + ' está desconectado', true); return; }
    closeSheet(); S.fake = f; render(); toast('Controlando ' + f.name + ' (simulado)');
  }

  /* Búsqueda: se escribe en el celular, los resultados salen en la TV */
  var qTimer = null;
  function openSearch() {
    openSheet('search', '<h2>Buscar en la TV</h2><p class="sub">Escribe aquí; los resultados aparecen en la pantalla.</p>' +
      '<input class="in-l" id="sq" type="search" placeholder="Película, serie, app o canal" enterkeyhint="search" autocomplete="off">' +
      '<div class="chips"><button data-q="Marea">Marea</button><button data-q="Netflix">Netflix</button><button data-q="Partido">Partido</button><button data-q="Canal">Canales</button><button data-q="Estrellas">Estrellas</button></div>' +
      '<button class="btn" data-act="closeSheet">Listo, elegir con el control</button>');
    var q = $('sq'); q.value = S.room && S.room.screen === 'search' ? (S.room.query || '') : '';
    setTimeout(function () { try { q.focus(); } catch (e) { /* ignore */ } }, 60);
    q.addEventListener('input', function () { var v = q.value; clearTimeout(qTimer); qTimer = setTimeout(function () { send({ t: 'search', q: v }); }, 300); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { q.blur(); closeSheet(); send({ t: 'key', k: 'DOWN' }); } });
    send({ t: 'search', q: q.value });
  }

  /* ---------- control por voz (reconocimiento de voz del navegador) ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, listening = false;
  function openVoice() {
    openSheet('voice', '<h2>Control por voz</h2><p class="sub">Dilo y pasa en la TV.</p>' +
      '<button class="mic" id="micBtn" data-act="listen" aria-label="Hablar">🎤</button>' +
      '<p class="vtext" id="vText">' + (SR ? 'Toca el micrófono y habla' : 'Escribe lo que dirías') + '</p><p class="vreply" id="vReply"></p>' +
      '<div class="chips"><button data-say="Abre Netflix">«Abre Netflix»</button><button data-say="Cambia al canal 5">«Cambia al canal 5»</button><button data-say="Sube el volumen">«Sube el volumen»</button>' +
      '<button data-say="Busca Marea Alta">«Busca Marea Alta»</button><button data-say="Pausa">«Pausa»</button><button data-say="Modo noche">«Modo noche»</button><button data-say="Apaga la tele">«Apaga la tele»</button></div>' +
      '<form class="vform" id="vForm"><input class="in-l" id="vIn" placeholder="o escríbelo aquí" autocomplete="off"><button>Enviar</button></form>');
    $('vForm').onsubmit = function (e) { e.preventDefault(); var v = $('vIn').value.trim(); if (v) { $('vIn').value = ''; runVoice(v); } };
    if (SR) listen();
  }
  function listen() {
    if (!SR) { $('vReply').textContent = 'Tu navegador no tiene dictado por voz: escríbelo abajo.'; return; }
    if (listening) { stopListening(); return; }
    try {
      rec = new SR(); rec.lang = 'es-MX'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      rec.onresult = function (e) {
        var txt = '', fin = false;
        for (var i = e.resultIndex; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
        if ($('vText')) $('vText').textContent = '«' + txt + '»';
        if (fin) runVoice(txt);
      };
      rec.onerror = function (e) {
        var m = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Permite el micrófono para usar la voz, o escríbelo abajo.' : e.error === 'no-speech' ? 'No te escuché. Toca el micrófono e intenta de nuevo.' : 'No se pudo usar el micrófono. Escríbelo abajo.';
        if ($('vReply')) $('vReply').textContent = m;
      };
      rec.onend = function () { listening = false; if ($('micBtn')) $('micBtn').className = 'mic'; };
      rec.start(); listening = true; $('micBtn').className = 'mic on'; $('vText').textContent = 'Te escucho…'; $('vReply').textContent = '';
    } catch (e) { listening = false; $('vReply').textContent = 'No se pudo usar el micrófono. Escríbelo abajo.'; }
  }
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch (e) { /* ignore */ } } listening = false; }

  var NUM = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100 };
  function norm(t) { return t.toLowerCase().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
  function numIn(t) { var m = /(\d+)/.exec(t); if (m) return Number(m[1]); for (var w in NUM) if (NUM.hasOwnProperty(w) && new RegExp('\\b' + w + '\\b').test(t)) return NUM[w]; return null; }
  /* Texto → comando(s) para la TV, más una respuesta corta. null = no entendido. */
  function parseVoice(raw) {
    var t = norm(raw), n, m;
    if (/(encuentra|busca|donde esta|suena|hacer sonar).*(control)/.test(t)) return { cmds: [{ t: 'find', on: true }], reply: 'Haciendo sonar tu control', sheet: 'find' };
    if (/(solo escuchar|solo audio|apaga la pantalla)/.test(t)) return { exp: 'listen' };
    if (/modo noche/.test(t)) return { exp: 'night' };
    if (/(modo gaming|modo juego|modo gamer)/.test(t)) return { exp: 'gaming' };
    if (/noche de peliculas/.test(t)) return { exp: 'movies' };
    if (/(quita|sin) (la )?experiencia/.test(t)) return { exp: 'none' };
    if (/(apaga|apagar)/.test(t)) return { cmds: [{ t: 'power', on: false }], reply: 'Apagando la TV' };
    if (/(enciende|prende|encender|prender)/.test(t)) return { cmds: [{ t: 'power', on: true }], reply: 'Encendiendo la TV' };
    if (/(quita el silencio|activa el sonido|con sonido|desilencia)/.test(t)) return { cmds: [{ t: 'mute', on: false }], reply: 'Sonido activado' };
    if (/(silencio|silencia|mute|sin sonido|quita el sonido)/.test(t)) return { cmds: [{ t: 'mute', on: true }], reply: 'TV en silencio' };
    if (/(volumen|sonido)/.test(t)) {
      n = numIn(t);
      if (n !== null && /(volumen|sonido) (a|en|al)? ?\d|(pon|deja|ajusta)/.test(t)) return { cmds: [{ t: 'vol', v: n }], reply: 'Volumen en ' + Math.min(100, n) };
      if (/(sube|subir|aumenta|mas alto|mas fuerte|mas)/.test(t)) return { cmds: [{ t: 'vol', d: 10 }], reply: 'Subiendo el volumen' };
      if (/(baja|bajar|disminuye|mas bajo|menos)/.test(t)) return { cmds: [{ t: 'vol', d: -10 }], reply: 'Bajando el volumen' };
      if (n !== null) return { cmds: [{ t: 'vol', v: n }], reply: 'Volumen en ' + Math.min(100, n) };
    }
    if (/(canal|pon el|cambia al)/.test(t) && (n = numIn(t)) !== null) {
      if (C.channel(n)) return { cmds: [{ t: 'channel', n: n }], reply: 'Cambiando al canal ' + n };
      return { reply: 'No hay canal ' + n + '. Prueba con el 2, 5, 7, 9 u 11.' };
    }
    if (/(siguiente canal|canal siguiente|sube (de |el )?canal)/.test(t)) return { cmds: [{ t: 'chstep', d: 1 }], reply: 'Siguiente canal' };
    if (/(canal anterior|baja (de |el )?canal)/.test(t)) return { cmds: [{ t: 'chstep', d: -1 }], reply: 'Canal anterior' };
    if (/(tv en vivo|television en vivo|canales)/.test(t)) return { cmds: [{ t: 'open', id: 'tv' }], reply: 'Abriendo TV en vivo' };
    if (/netflix/.test(t)) return { cmds: [{ t: 'app', id: 'netflix' }], reply: 'Abriendo Netflix' };
    if (/(prime|amazon)/.test(t)) return { cmds: [{ t: 'app', id: 'prime' }], reply: 'Abriendo Prime Video' };
    if (/(youtube|you tube)/.test(t)) return { cmds: [{ t: 'app', id: 'youtube' }], reply: 'Abriendo YouTube' };
    if ((m = /^(busca|buscar|buscame|encuentra) (.+)$/.exec(t))) return { cmds: [{ t: 'search', q: m[2] }], reply: 'Buscando «' + m[2] + '»' };
    if (/(partido|futbol|halcones|toros|deportes)/.test(t)) return { cmds: [{ t: 'channel', n: 7 }], reply: 'Poniendo el partido en el canal 7' };
    if (/(marea alta|seguir viendo|la serie)/.test(t)) return { cmds: [{ t: 'open', id: 'series', from: 'resume' }], reply: 'Continuando Marea Alta' };
    if (/(que vemos|match de peliculas)/.test(t)) return { cmds: [{ t: 'open', id: 'swipe' }], reply: 'Abriendo ¿Qué vemos?' };
    if (/(atrapa estrellas|juego|jugar)/.test(t)) return { cmds: [{ t: 'game' }], reply: 'Abriendo Atrapa estrellas' };
    if (/(adelanta)/.test(t)) return { cmds: [{ t: 'key', k: 'FF' }], reply: 'Adelantando 30 segundos' };
    if (/(retrocede|rebobina)/.test(t)) return { cmds: [{ t: 'key', k: 'REW' }], reply: 'Regresando 30 segundos' };
    if (/(pausa|pausar|deten|detener)/.test(t)) return { cmds: [{ t: 'pause' }], reply: 'En pausa' };
    if (/(reproduce|reanuda|continua|play|dale play|sigue)/.test(t)) return { cmds: [{ t: 'play' }], reply: 'Reproduciendo' };
    if (/(inicio|pantalla principal|home)/.test(t)) return { cmds: [{ t: 'home' }], reply: 'Yendo al inicio' };
    if (/menu/.test(t)) return { cmds: [{ t: 'menu' }], reply: 'Abriendo el menú' };
    if (/(regresa|atras|volver)/.test(t)) return { cmds: [{ t: 'key', k: 'BACK' }], reply: 'Regresando' };
    return null;
  }
  function runVoice(text) {
    stopListening();
    var r = parseVoice(text), reply;
    if (r && r.exp) { var e = expById(r.exp); if (e) { applyExp(e, true); reply = r.exp === 'none' ? 'Experiencia quitada' : 'Activando ' + e.name; } }
    else if (r && r.cmds) { reply = r.reply; send({ t: 'say', text: text, reply: reply }); for (var i = 0; i < r.cmds.length; i++) send(r.cmds[i]); }
    else if (r) reply = r.reply;
    if (!reply) { reply = 'No entendí «' + text + '». Prueba «abre YouTube» o «canal 5».'; buzz(); }
    else buzz();
    if (r && r.exp) send({ t: 'say', text: text, reply: reply });
    if ($('vText')) $('vText').textContent = '«' + text + '»';
    if ($('vReply')) $('vReply').textContent = reply;
    if (r && r.sheet === 'find') openFind(true);
  }

  /* ---------- experiencias: ajustes de la TV en un toque (volumen, brillo, pantalla) ---------- */
  var PRESETS = [
    { id: 'movies', ic: '🍿', name: 'Noche de películas', vol: 60, bright: 65, desc: 'Películas recomendadas con tus gustos · luz baja' },
    { id: 'night', ic: '🌙', name: 'Modo noche', vol: 20, bright: 35, sleep: 30, desc: 'Volumen y brillo bajos · la TV se apaga en 30 min' },
    { id: 'gaming', ic: '🎮', name: 'Modo gaming', vol: 70, bright: 100, desc: 'Te lleva a los juegos · volumen alto' },
    { id: 'listen', ic: '🎧', name: 'Solo escuchar', vol: 45, bright: 100, audio: true, desc: 'Apaga la pantalla, sigue el sonido' }
  ];
  function customs() { return lsJSON('cp-exps', []); }
  function expById(id) {
    if (id === 'none') return { id: 'none', name: '' };
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    var c = customs(); for (var j = 0; j < c.length; j++) if (c[j].id === id) return c[j];
    return null;
  }
  function applyExp(e, quiet) {
    if (e.id === 'none') { send({ t: 'exp', id: 'none' }); if (!quiet) toast('Experiencia quitada'); }
    else { send({ t: 'exp', id: e.id, name: e.name, vol: e.vol, bright: e.bright, audio: !!e.audio, sleep: e.sleep || 0, genres: e.id === 'movies' ? tastes() : [], who: ls.get('cp-name') || '' }); if (!quiet) toast('✨ ' + e.name + ' en la TV'); }
    if (S.fake) return;
    if (S.sheet === 'exps') closeSheet();
  }
  function expRow(e, custom) {
    var on = S.room && S.room.exp === e.name;
    return '<button class="opt' + (on ? ' on' : '') + '" data-exp="' + esc(e.id) + '"><span class="ic">' + (e.ic || '⭐') + '</span><span class="grow"><span class="t">' + esc(e.name) + '</span><span class="s" style="display:block">' + esc(e.desc || ('Volumen ' + e.vol + ' · brillo ' + e.bright + '%' + (e.audio ? ' · solo audio' : ''))) + '</span></span>' +
      (custom ? '<span class="del" data-delexp="' + esc(e.id) + '" aria-label="Borrar">✕</span>' : (on ? '<b style="color:#7A4CC4">✓</b>' : '')) + '</button>';
  }
  function openExps() {
    var html = '<h2>Experiencias</h2><p class="sub">Ajusta la TV para cada momento en un toque.</p>';
    for (var i = 0; i < PRESETS.length; i++) html += expRow(PRESETS[i]);
    var c = customs(); if (c.length) { html += '<p class="lf">Tus experiencias</p>'; for (var j = 0; j < c.length; j++) html += expRow(c[j], true); }
    html += '<div class="stack" style="margin-top:8px"><button class="btn" data-act="newExp">＋ Crear experiencia</button>' + (S.room && S.room.exp ? '<button class="btn ghost" data-exp="none">Quitar experiencia actual</button>' : '') + '</div>';
    openSheet('exps', html);
  }
  /* Gustos para Noche de películas: se eligen una vez y se recuerdan en este celular */
  var GENRES = [[35, 'Comedia'], [28, 'Acción'], [18, 'Drama'], [27, 'Terror'], [10749, 'Romance'], [878, 'Ciencia ficción'], [16, 'Animación'], [53, 'Suspenso'], [12, 'Aventura'], [10751, 'Familia'], [99, 'Documental'], [80, 'Crimen']];
  function tastes() { var t = lsJSON('cp-tastes', []); return Object.prototype.toString.call(t) === '[object Array]' ? t.slice(0, 3) : []; }
  function openTastes() {
    var mine = tastes(), html = '<h2>🍿 Noche de películas</h2><p class="sub">¿Qué se te antoja? Elige hasta 3 y te recomendamos en la TV.</p><div class="chips">';
    for (var i = 0; i < GENRES.length; i++) html += '<button class="' + (mine.indexOf(GENRES[i][0]) >= 0 ? 'on' : '') + '" data-gen="' + GENRES[i][0] + '">' + GENRES[i][1] + '</button>';
    html += '</div><div class="stack"><button class="btn" data-act="tastesGo">Ver recomendaciones en la TV</button><button class="btn ghost" data-act="exps">Volver</button></div>';
    openSheet('tastes', html);
  }
  function openNewExp() {
    var v = S.room && S.room.vol != null ? S.room.vol : 30, b = S.room && S.room.bright != null ? S.room.bright : 100;
    openSheet('newExp', '<h2>Crear experiencia</h2><p class="sub">Se guarda en este celular.</p>' +
      '<label class="lf">Nombre</label><input class="in-l" id="xName" maxlength="22" placeholder="Ej. Domingo de series">' +
      '<label class="lf">Volumen · <span id="xVolL">' + v + '</span></label><input type="range" id="xVol" min="0" max="100" step="5" value="' + v + '">' +
      '<label class="lf">Brillo · <span id="xBriL">' + b + '%</span></label><input type="range" id="xBri" min="20" max="100" step="5" value="' + b + '">' +
      '<label class="lf" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="xAudio"> Solo audio (apaga la pantalla)</label>' +
      '<div class="stack" style="margin-top:14px"><button class="btn" data-act="saveExp">Guardar y aplicar</button><button class="btn ghost" data-act="exps">Cancelar</button></div>');
    $('xVol').oninput = function () { $('xVolL').textContent = this.value; };
    $('xBri').oninput = function () { $('xBriL').textContent = this.value + '%'; };
  }
  function saveExp() {
    var name = $('xName').value.trim() || 'Mi experiencia';
    var e = { id: 'c' + Date.now().toString(36), name: name, vol: Number($('xVol').value), bright: Number($('xBri').value), audio: $('xAudio').checked };
    var list = customs(); list.unshift(e); ls.set('cp-exps', JSON.stringify(list.slice(0, 8)));
    applyExp(e); closeSheet();
  }

  /* ---------- encontrar mi control (simulado en la TV) ---------- */
  function openFind(already) {
    if (!already) send({ t: 'find', on: true });
    openSheet('find', '<div style="text-align:center"><div class="mic on" style="background:#7A4CC4">🔊</div><h2>Haciendo sonar tu control</h2>' +
      '<p class="sub">' + (S.fake ? S.fake.name + ' es simulado: aquí no suena nada.' : 'Escucha el pitido y busca cerca de la TV. En la pantalla también lo verás.') + '</p></div>' +
      '<button class="btn" data-act="closeSheet">Ya lo encontré</button>');
  }

  /* ---------- diagnóstico de conexión ---------- */
  function openDiag() {
    openSheet('diag', '<h2>Diagnóstico de conexión</h2><p class="sub">Probando la conexión entre tu celular, la nube y la TV…</p><div class="diag" id="dg"><div><span>Midiendo…</span><b></b></div></div><div id="dgV"></div>' +
      '<button class="btn ghost" data-act="diag" style="margin-top:6px">Probar de nuevo</button>');
    if (S.fake) { $('dg').innerHTML = '<div><span>Decodificador</span><b>' + esc(S.fake.name) + ' (simulado)</b></div><div><span>Estado</span><b>' + STATE_TXT[S.fake.state] + '</b></div>'; $('dgV').innerHTML = '<div class="verdict" style="background:#FBF0DC;color:#7A5A1E">Es un decodificador simulado: no hay red real que medir.</div>'; return; }
    var times = [], code = S.code, room = null;
    (function ping(i) {
      if (i >= 3 || S.sheet !== 'diag') return done();
      var t0 = Date.now();
      store.getRoom(code, function (err, r) { if (!err) { times.push(Date.now() - t0); room = r; } ping(i + 1); });
    })(0);
    function done() {
      if (S.sheet !== 'diag') return;
      var sub = document.querySelector('#sheet .sub'); if (sub) sub.textContent = 'Resultado de la prueba';
      var avg = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : null;
      var age = room && room.aliveAt ? Math.round((Date.now() - room.aliveAt) / 1000) : null;
      var conn = navigator.connection || navigator.webkitConnection, net = conn ? ((conn.type && conn.type !== 'unknown' ? conn.type : '') || conn.effectiveType || '').toUpperCase() : '';
      var tvOk = room && age !== null && age < 60 && !room.off;
      $('dg').innerHTML =
        '<div><span>Decodificador</span><b>' + esc((room && room.tvName) || 'Sala') + '</b></div>' +
        '<div><span>Celular → nube</span><b>' + (avg === null ? 'Sin respuesta' : avg + ' ms') + '</b></div>' +
        '<div><span>TV → nube</span><b>' + (room && room.tvLat ? room.tvLat + ' ms' : '—') + '</b></div>' +
        '<div><span>Último contacto de la TV</span><b>' + (age === null ? '—' : age < 5 ? 'ahora' : 'hace ' + age + ' s') + '</b></div>' +
        '<div><span>Estado de la TV</span><b>' + (!room ? 'No encontrada' : room.off ? 'En reposo' : (age !== null && age < 60) ? 'Encendida' : 'Sin señal') + '</b></div>' +
        '<div><span>Red de tu celular</span><b>' + (net || 'No disponible') + '</b></div>' +
        '<div><span>Nombre del Wi-Fi</span><b>No visible desde el navegador</b></div>';
      var good = avg !== null && avg < 600 && tvOk, ok = avg !== null && tvOk;
      $('dgV').innerHTML = '<div class="verdict" style="background:' + (good ? '#E3F4EA;color:#1F6B43' : ok ? '#FBF0DC;color:#7A5A1E' : '#FBE3E7;color:#9A2236') + '">' +
        (good ? 'Todo bien: tu celular y la TV se comunican rápido.' : ok ? 'Funciona, pero la conexión está lenta. Acércate al módem o usa Wi-Fi.' : !room ? 'No encontramos la TV. Vuelve a escanear su QR.' : room.off ? 'La TV está en reposo: enciéndela con ⏻.' : 'La TV no responde. Revisa que siga encendida y con internet.') + '</div>';
      send({ t: 'diag' });
    }
  }

  /* ---------- eventos (delegación) ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button,[data-go],[data-delexp]'); if (!el) return;
    if (el.tagName === 'BUTTON') buzz();
    var g = function (a) { return el.getAttribute(a); };
    var k = g('data-key'), cmd = g('data-cmd'), go = g('data-go'), open = g('data-open'), act = g('data-act'), seg = g('data-seg');
    if (g('data-delexp')) { e.stopPropagation(); var id = g('data-delexp'), l = customs().filter(function (x) { return x.id !== id; }); ls.set('cp-exps', JSON.stringify(l)); openExps(); return; }
    if (k) send({ t: 'key', k: k });
    else if (g('data-vol')) { var d = Number(g('data-vol')); send({ t: 'vol', d: d }); if (!S.fake) { var nv = Math.max(0, Math.min(100, (S.room.vol == null ? 30 : S.room.vol) + d)); S.room.vol = nv; S.room.muted = false; renderHeader(); toast('Volumen ' + nv); } }
    else if (g('data-app')) { send({ t: 'app', id: g('data-app') }); if (!S.fake) toast('Abriendo ' + APP_NAMES[g('data-app')] + ' en la TV'); }
    else if (g('data-room')) pickRoom(g('data-room'));
    else if (g('data-fake') !== null && g('data-fake') !== undefined && el.hasAttribute('data-fake')) pickFake(Number(g('data-fake')));
    else if (g('data-q')) { var q = $('sq'); if (q) { q.value = g('data-q'); send({ t: 'search', q: q.value }); } }
    else if (g('data-say')) runVoice(g('data-say'));
    else if (g('data-exp')) { var ex = expById(g('data-exp')); if (ex && ex.id === 'movies') openTastes(); else if (ex) applyExp(ex); }
    else if (g('data-gen')) {
      if (!el.classList.contains('on') && document.querySelectorAll('[data-gen].on').length >= 3) toast('Máximo 3: quita uno primero');
      else el.classList.toggle('on');
    }
    else if (act === 'tastesGo') { var on = document.querySelectorAll('[data-gen].on'), ids = []; for (var gi = 0; gi < on.length; gi++) ids.push(Number(on[gi].getAttribute('data-gen'))); ls.set('cp-tastes', JSON.stringify(ids)); applyExp(expById('movies')); closeSheet(); }
    else if (cmd) { send({ t: cmd }); if (cmd === 'menu' && !S.fake) toast(S.room && S.room.menu ? 'Cerrando el menú' : 'Menú abierto en la TV'); }
    else if (open) { send({ t: 'open', id: open, from: g('data-from') || '' }); toast('Abriendo en la TV…'); }
    else if (go) setTab(go);
    else if (seg) { S.seg = seg; renderAhora(); }
    else if (act === 'power') { send({ t: 'power' }); if (!S.fake) toast(S.room && S.room.off ? 'Encendiendo la TV' : 'Apagando la TV'); }
    else if (act === 'mute') { send({ t: 'mute' }); if (!S.fake) { S.room.muted = !S.room.muted; renderHeader(); toast(S.room.muted ? 'TV en silencio' : 'Sonido activado'); } }
    else if (act === 'decoders') openDecoders();
    else if (act === 'saveName') { var nm = ($('nameIn').value || '').trim().substring(0, 18); if (nm) { S.name = nm; ls.set('cp-name', nm); if (S.pid) store.updatePlayer(S.code, S.pid, { name: nm }, function () {}); toast('Listo: en la TV apareces como ' + nm); closeSheet(); } }
    else if (act === 'search') openSearch();
    else if (act === 'voice') openVoice();
    else if (act === 'listen') listen();
    else if (act === 'exps') openExps();
    else if (act === 'newExp') openNewExp();
    else if (act === 'saveExp') saveExp();
    else if (act === 'find') openFind();
    else if (act === 'diag') openDiag();
    else if (act === 'pause') { send({ t: 'pause' }); toast('Pausado: mira la TV'); }
    else if (act === 'play') send({ t: 'play' });
    else if (act === 'saveSong') saveSong(sceneNow().song);
    else if (act === 'product') openProduct(sceneNow().products[Number(g('data-i'))]);
    else if (act === 'saveBanner') { saveSong($('banner')._song); $('banner').hidden = true; }
    else if (act === 'closeBanner') $('banner').hidden = true;
    else if (act === 'closeSheet') closeSheet();
    else if (act === 'exitGame') {
      if (S.padDir) setDir(0);
      openSheet('exit', '<h2 style="margin-bottom:6px">¿Salir del juego?</h2><p class="sub">La partida termina para todos y la TV regresa al inicio.</p><div class="stack"><button class="btn" data-act="confirmExit">Salir del juego</button><button class="btn ghost" data-act="closeSheet">Seguir jugando</button></div>');
    }
    else if (act === 'confirmExit') { send({ t: 'home' }); closeSheet(); toast('Saliendo del juego…'); }
  });
  $('scrim').onclick = closeSheet;

  function setTab(t) {
    S.tab = t;
    var panes = document.querySelectorAll('[data-tab]'); for (var i = 0; i < panes.length; i++) panes[i].hidden = panes[i].getAttribute('data-tab') !== t;
    var tabs = document.querySelectorAll('.tab'); for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j].getAttribute('data-go') === t);
    render(); window.scrollTo(0, 0);
  }

  /* Botón presionado visible en iOS (Safari no muestra :active sin esto) y en Android. */
  document.addEventListener('touchstart', function () {}, { passive: true });
  var pressedAt = 0;
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b) return;
    b.classList.add('pressed'); pressedAt = Date.now();
  }, { passive: true });
  function release() {
    var wait = Math.max(0, 140 - (Date.now() - pressedAt));
    setTimeout(function () { var l = document.querySelectorAll('button.pressed'); for (var i = 0; i < l.length; i++) l[i].classList.remove('pressed'); }, wait);
  }
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('scroll', release, { passive: true });

  /* logos oficiales en los accesos directos (si no cargan, se queda el nombre) */
  function paintAppLogos() {
    var bs = document.querySelectorAll('.apps button[data-app]');
    for (var i = 0; i < bs.length; i++) { var id = bs[i].getAttribute('data-app'), im = CP.logos.img(id, 'w92', 'logo'); if (im && !bs[i].querySelector('img')) bs[i].insertAdjacentHTML('afterbegin', im); }
  }
  CP.logos.ready(paintAppLogos);

  connect(S.code);
})(window.CP);
