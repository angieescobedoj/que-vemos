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
  var APP_NAMES = {}; for (var ai = 0; ai < C.APPS.length; ai++) APP_NAMES[C.APPS[ai].id] = C.APPS[ai].title;

  /* ---------- háptica: vibración en Android; en iPhone (iOS 18+) el truco del interruptor nativo ---------- */
  var hapLabel = null;
  function buzz() {
    if (typeof PREF !== 'undefined' && !PREF.vib) return;
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
        decUpdate('r' + code, function (x) { x.linked = true; }); S.fakeId = null; S.noDec = false;
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
    $('decName').textContent = S.fake ? S.fake.name : (realAlias(S.code) || S.room.tvName || 'Sala');
    $('decState').textContent = S.offline && !S.fake ? 'Sin conexión' : (STATE_TXT[st] + (S.fake ? ' · simulado' : ''));
    $('dot').className = 'dot' + (st === 'off' ? ' off' : st === 'sleep' ? ' sleep' : '');
    $('decState').parentNode.className = st === 'on' && !(S.offline && !S.fake) ? 'on' : '';
    $('pwr').className = 'pwr' + (st === 'sleep' ? ' sleep' : '');
    var vol = S.fake ? S.fake.vol : (S.room.vol == null ? 30 : S.room.vol), muted = S.fake ? S.fake.muted : S.room.muted;
    $('muteBtn').classList.toggle('on', !!muted);
    var playing = !S.fake && !!S.room.playing;
    $('playBtn').classList.toggle('playing', playing); $('miniPlay').classList.toggle('playing', playing);
    $('fakeNote').hidden = !S.fake;
    if (S.fake) $('fakeNote').textContent = S.fake.name + ' es un decodificador simulado: los botones responden aquí, pero no hay una TV real detrás. Toca su nombre arriba para elegir otro.';
  }
  function appColor(id) { for (var i = 0; i < C.APPS.length; i++) if (C.APPS[i].id === id) return C.APPS[i].color; return '#7A4CC4'; }

  /* ---------- decodificador simulado: responde con feedback, sin TV detrás ---------- */
  function fakeCommand(cmd) {
    var f = S.fake, n = f.name;
    if (cmd.t === 'peek' || cmd.t === 'vote') return;
    if (cmd.t === 'power') { f.state = f.state === 'sleep' ? 'on' : 'sleep'; toast(n + (f.state === 'sleep' ? ' en reposo' : ' encendida') + ' (simulado)'); renderHeader(); return; }
    if (f.state === 'sleep') { toast(n + ' está en reposo · toca ⏻'); return; }
    if (cmd.t === 'vol') { f.vol = Math.max(0, Math.min(100, typeof cmd.v === 'number' ? cmd.v : f.vol + cmd.d)); f.muted = false; toast(n + ' · volumen ' + f.vol + ' (simulado)'); renderHeader(); return; }
    if (cmd.t === 'mute') { f.muted = !f.muted; toast(n + (f.muted ? ' en silencio' : ' con sonido') + ' (simulado)'); renderHeader(); return; }
    if (cmd.t === 'app') { toast('Abriendo ' + APP_NAMES[cmd.id] + ' en ' + n + ' (simulado)'); return; }
    if (cmd.t === 'key') { toast(n + ' · ' + ({ UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', OK: 'OK', BACK: 'Regresar', PLAY: '⏯', REW: '⏪', FF: '⏩' }[cmd.k] || cmd.k) + ' (simulado)'); return; }
    toast('Enviado a ' + n + ' (simulado)');
  }

  /* ---------- helpers de estado ---------- */
  function pos() { var r = S.room; if (!r) return 0; return r.playing ? r.pos + Math.max(0, (Date.now() - r.posAt) / 1000) : r.pos; }
  function mck() { return C.matchClock(Math.max(0, Date.now() - (S.room.matchStart || Date.now()))); }
  function matchMinute() { return mck().label; }
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
    if (S.fake) { renderHeader(); return; }
    renderHeader(); renderGame(); renderPad2();
    /* v7.35 · momentos del partido: al elegirlo (previa), jugada clave (gol) y medio tiempo llegan como hojas */
    var inMatch = r.screen === 'player' && r.content === 'match';
    if (S.mevSeen === undefined) S.mevSeen = r.mev ? r.mev.seq : 0;
    if (r.mev && r.mev.seq !== S.mevSeen) { S.mevSeen = r.mev.seq; if (inMatch) { openMoment(r.mev.k); buzz(); setTimeout(buzz, 180); } }
    if (!inMatch && /^(mpre|mgoal|mht)$/.test(S.sheet || '')) closeSheet();
    if (S.tab === 'ahora') renderAhora();
    /* receta: llega sola a los pocos segundos de empezar el video (la TV no se pausa) */
    if (S.recipeSeen === undefined) S.recipeSeen = r.recipeSeq || 0;
    if (r.recipeSeq && r.recipeSeq !== S.recipeSeen) { S.recipeSeen = r.recipeSeq; showRecipeBanner(); }
    if (S.sheet === 'recipe' && S.rcTab === 'pasos' && S.rcStepShown !== (r.recipeStep || 0)) openRecipe();
    if (S.sheet === 'match' && (r.playing || r.screen !== 'player' || r.content !== 'match')) closeSheet();   /* se reanudó o cambió de canal */
    /* pausa en un canal: sugerencia (On Demand renta o Anytime) */
    mvWatch(r);
    if (S.offerSeen === undefined) S.offerSeen = r.offer ? r.offer.seq : 0;
    if (r.offer && r.offer.seq !== S.offerSeen) { S.offerSeen = r.offer.seq; showOffer(r.offer); }
  }
  function renderAhora() {
    var r = S.room, el = $('ahora'), html = '';
    if (r.screen === 'player' && r.content === 'match') {
      var m = C.MATCH;
      var ck0 = mck();
      html += '<p class="eyebrow">Partido en vivo · ' + ck0.label + '</p><h2 style="margin-top:4px">' + m.home.name + ' ' + ck0.score[0] + ' – ' + ck0.score[1] + ' ' + m.away.name + '</h2>';
      html += matchInfoHtml(SEG_LIVE);
      el.innerHTML = html; return;
    }
    if (r.screen === 'player' && r.content === 'series') {
      var sc = sceneNow();
      html += '<p class="eyebrow">En esta escena · ' + esc(sc.place) + '</p><h2 style="margin-top:4px">Los Pecadores</h2>';
      html += '<div style="margin-top:12px">' + (r.playing
        ? '<button class="btn" data-act="pause">❚❚  Pausar y descubrir en la TV</button>'
        : '<button class="btn ghost" data-act="play">▶  Seguir viendo</button>') + '</div>';
      html += '<div class="sec"><p class="sec-h">Personajes</p><div class="card">';
      for (var c = 0; c < sc.cast.length; c++) html += '<div class="item"><span class="av">' + esc(sc.cast[c][0].charAt(0)) + '</span><div class="grow"><div class="t">' + esc(sc.cast[c][0]) + '</div><div class="s">Interpretado por ' + esc(sc.cast[c][1]) + '</div></div></div>';
      html += '</div></div>';
      html += '<div class="sec"><p class="sec-h">Productos de la escena</p><div class="card">';
      for (var p = 0; p < sc.products.length; p++) html += '<div class="item"><span class="av">🛍</span><div class="grow"><div class="t">' + esc(sc.products[p][0]) + '</div><div class="s">' + esc(sc.products[p][1]) + '</div></div><button class="btn sm ghost" data-act="product" data-i="' + p + '">Ver</button></div>';
      html += '</div></div>';
      el.innerHTML = html; return;   /* el soundtrack de Los Pecadores llega al terminar la película */
    }
    html += '<div class="empty"><p class="eyebrow">Ahora en la TV</p><h2 style="margin-top:6px">Elige algo para ver</h2><p class="muted">Aquí verás información de lo que se está reproduciendo: personajes, canciones, productos o la alineación del partido.</p><div class="stack">' +
      '<button class="btn" data-open="match">Ver el partido en vivo</button><button class="btn ghost" data-open="series" data-from="">Ver Los Pecadores</button><button class="btn ghost" data-cmd="game">Jugar Atrapa estrellas</button></div></div>';
    html += soundtrackHtml();
    el.innerHTML = html;
  }
  /* Alineación / Estadísticas / Datos del partido: se usa en "Ahora en la TV" y en la hoja que sale al pausar */
  var SEG_NAMES = { lineup: ['Alineaciones', 'las alineaciones'], h2h: ['Historial', 'el historial'], table: ['Tabla', 'la tabla de posiciones'], inj: ['Lesionados', 'los lesionados'], stats: ['Estadísticas', 'las estadísticas'] };
  var SEG_PRE = ['lineup', 'h2h', 'table', 'inj'], SEG_LIVE = ['lineup', 'stats', 'h2h', 'table', 'inj'];
  function statBars(list) {
    var m = C.MATCH, html = '';
    for (var i = 0; i < list.length; i++) {
      var s = list[i], tot = (s[1] + s[2]) || 1;
      html += '<div class="stat"><div class="row"><span>' + s[1] + s[3] + '</span><span class="muted">' + s[0] + '</span><span>' + s[2] + s[3] + '</span></div><div class="bars"><i style="flex:' + s[1] / tot + ';background:' + m.home.color + '"></i><i style="flex:' + s[2] / tot + ';background:' + m.away.color + '"></i></div></div>';
    }
    return html;
  }
  /* tabla: [equipo, PJ, PTS, DG]; resalta a los dos equipos del partido */
  function tableHtml(rows, moves) {
    var m = C.MATCH, h = '<div class="mtable"><div class="mt-h"><span>#</span><span class="grow">Equipo</span><span>PJ</span><span>DG</span><span>PTS</span></div>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], hl = r[0] === m.home.name ? m.home.color : r[0] === m.away.name ? m.away.color : '', mv = moves ? moves[r[0]] : 0;
      h += '<div class="mt-r' + (hl ? ' hl' : '') + '"' + (hl ? ' style="--tc:' + hl + '"' : '') + '><span>' + (i + 1) + '</span><span class="grow">' + esc(r[0]) +
        (moves ? (mv > 0 ? ' <em class="up">▲' + mv + '</em>' : mv < 0 ? ' <em class="dn">▼' + (-mv) + '</em>' : '') : '') + '</span><span>' + r[1] + '</span><span>' + (r[3] > 0 ? '+' : '') + r[3] + '</span><b>' + r[2] + '</b></div>';
    }
    return h + '</div>';
  }
  /* Alineaciones / Historial / Tabla / Lesionados (y Estadísticas en vivo): previa, pausa y "Ahora en la TV" */
  function matchInfoHtml(segs) {
    var m = C.MATCH, html = '', i;
    segs = segs || SEG_LIVE; if (segs.indexOf(S.seg) < 0) S.seg = segs[0];
    if (!S.peeked[S.seg]) { S.peeked[S.seg] = true; send({ t: 'peek', what: SEG_NAMES[S.seg][1] }); }
    html += '<div class="seg mseg">';
    for (i = 0; i < segs.length; i++) html += '<button data-seg="' + segs[i] + '"' + (S.seg === segs[i] ? ' class="on"' : '') + '>' + SEG_NAMES[segs[i]][0] + '</button>';
    html += '</div>';
    if (S.seg === 'lineup') {
      html += '<div class="lineup">' + team(m.home, m.lineups.home) + team(m.away, m.lineups.away) + '</div>';
    } else if (S.seg === 'stats') {
      html += statBars(m.stats);
    } else if (S.seg === 'h2h') {
      var rc = m.h2h.record;
      html += '<div class="h2h"><div><b style="color:' + m.home.color + '">' + rc[0] + '</b><span>' + esc(m.home.name) + '</span></div><div><b>' + rc[2] + '</b><span>Empates</span></div><div><b style="color:' + m.away.color + '">' + rc[1] + '</b><span>' + esc(m.away.name) + '</span></div></div>';
      html += '<p class="sec-h" style="margin-top:16px">Últimos 5 partidos</p>';
      for (i = 0; i < m.h2h.last.length; i++) html += '<div class="mrow"><div class="grow"><div class="t">' + esc(m.h2h.last[i][0]) + '</div><div class="s">' + esc(m.h2h.last[i][1]) + '</div></div></div>';
      html += '<div class="mfact">' + esc(m.facts[2]) + '</div>';
    } else if (S.seg === 'table') {
      html += '<p class="sec-h" style="margin-top:4px">Liga de la Ciudad · antes de la jornada 12</p>' + tableHtml(m.table);
    } else if (S.seg === 'inj') {
      var tms = [['home', m.home], ['away', m.away]];
      for (var t = 0; t < 2; t++) {
        html += '<p class="sec-h" style="margin-top:' + (t ? 16 : 4) + 'px"><span class="sw" style="background:' + tms[t][1].color + '"></span>' + esc(tms[t][1].name) + '</p>';
        for (i = 0; i < m.injuries.length; i++) if (m.injuries[i][0] === tms[t][0]) {
          var j = m.injuries[i];
          html += '<div class="mrow"><span class="inj">✚</span><div class="grow"><div class="t">' + esc(j[1]) + ' <em>' + j[2] + '</em></div><div class="s">' + esc(j[3]) + ' · ' + esc(j[4]) + '</div></div></div>';
        }
      }
    }
    return html;
  }
  /* Al pausar el partido, el celular abre sus datos + la repetición en Anytime */
  function openMatchSheet() {
    var m = C.MATCH, of = C.offerSource('match').offer, ck = mck();
    openSheet('match', '<p class="eyebrow">Pausaste el partido · ' + ck.label + '</p><h2 style="margin-top:4px">' + esc(m.home.name) + ' ' + ck.score[0] + ' – ' + ck.score[1] + ' ' + esc(m.away.name) + '</h2>' +
      matchInfoHtml(SEG_LIVE) +
      (of ? '<div class="mreplay"><div class="grow"><div class="t">' + esc(of.line) + '</div><div class="s">Disponible en Anytime · desde el inicio</div></div><button class="btn sm ghost" data-act="offerGo" data-ch="match">Ver en la TV</button></div>' : '') +
      '<button class="btn" data-act="play" style="margin-top:14px">▶  Seguir viendo el partido</button>');
  }

  /* ---------- v7.35 · Partido en tres momentos (bottom sheets) ----------
     1) al elegirlo: alineaciones, historial, tabla y lesionados
     2) jugada clave (gol al 27'): repetición desde otro ángulo, dato del goleador y cómo cambia la tabla
     3) medio tiempo: estadísticas, mapa de calor, mejores jugadas, encuesta y promociones de patrocinadores */
  function openMoment(k) {
    S.mAng = 0; S.mPlay = 0;
    if (k === 'pre') { S.seg = 'lineup'; S.mVote = null; S.mHeat = 'home'; openPre(); }
    else if (k === 'goal') openGoal();
    else if (k === 'ht') openHT();
  }
  function reSheet(fn) { var st = $('sheet').scrollTop; fn(); $('sheet').scrollTop = st; }
  function openPre() {
    var m = C.MATCH;
    openSheet('mpre', '<p class="eyebrow">Empieza el partido · ' + esc(m.sub) + '</p><h2 style="margin-top:4px">' + esc(m.home.name) + ' vs. ' + esc(m.away.name) + '</h2>' +
      '<p class="sub">Todo lo que tienes que saber antes de verlo</p>' + matchInfoHtml(SEG_PRE) +
      '<button class="btn" data-act="closeSheet" style="margin-top:16px">Ver el partido</button>');
  }
  var ANGLES = ['Cámara aérea', 'Detrás de la portería', 'Cámara lateral'];
  /* repetición simulada: vista aérea animada (SVG) o la toma desde otra cámara con acercamiento */
  function replayHtml(ang, label) {
    var h = '<div class="rp">';
    if (ang === 0) {
      h += '<svg class="rp-pitch" viewBox="0 0 320 180" aria-label="Repetición vista aérea">' +
        '<rect width="320" height="180" fill="#2E7D49"/><g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"><rect x="6" y="6" width="308" height="168"/><line x1="160" y1="6" x2="160" y2="174"/><circle cx="160" cy="90" r="22"/><rect x="262" y="48" width="52" height="84"/><rect x="296" y="72" width="18" height="36"/></g>' +
        '<rect x="314" y="78" width="5" height="24" fill="#fff"/>' +
        '<g fill="#D9364F"><circle cx="300" cy="92" r="5"/><circle cx="262" cy="70" r="5"/><circle cx="265" cy="112" r="5"/><circle cx="240" cy="90" r="5"/></g>' +
        '<g fill="#2F6FE0" stroke="#fff" stroke-width="1"><circle r="5.5"><animateMotion dur="5s" repeatCount="indefinite" path="M200,150 L240,150 L240,150"/></circle>' +
        '<circle r="5.5"><animateMotion dur="5s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;.35;.6;1" calcMode="linear" path="M215,70 L276,96"/></circle></g>' +
        '<text font-size="9" fill="#fff" font-weight="700"><tspan x="196" y="168">Quiroga</tspan></text>' +
        '<circle r="3.5" fill="#fff" stroke="#111" stroke-width="1"><animateMotion dur="5s" repeatCount="indefinite" keyPoints="0;0.06;0.45;0.55;1;1" keyTimes="0;.2;.45;.6;.75;1" calcMode="linear" path="M200,150 L240,150 L276,96 L281,96 L316,84"/></circle>' +
        '<path d="M240,150 L276,96 L316,84" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.4" stroke-dasharray="4 4"/></svg>';
    } else {
      h += '<div class="rp-cam a' + ang + '" style="background-image:url(' + C.PHOTOS.match + '900)"></div>';
    }
    h += '<span class="rp-tag">REPETICIÓN · ' + esc(label || ANGLES[ang]) + '</span><span class="rp-bar"><i></i></span></div>';
    return h;
  }
  function goalTable() {
    var m = C.MATCH, ck = mck(), d = ck.score[0] - ck.score[1], before = {}, rows = [], i;
    for (i = 0; i < m.table.length; i++) {
      var r = m.table[i].slice(); before[r[0]] = i;
      if (r[0] === m.home.name) { r[1]++; r[2] += 3; r[3] += d; } else if (r[0] === m.away.name) { r[1]++; r[3] -= d; }
      rows.push(r);
    }
    rows.sort(function (a, b) { return b[2] - a[2] || b[3] - a[3] || before[a[0]] - before[b[0]]; });
    var moves = {};
    for (i = 0; i < rows.length; i++) moves[rows[i][0]] = before[rows[i][0]] - i;
    return { rows: rows, moves: moves };
  }
  function openGoal() {
    var m = C.MATCH, gl = m.goal, ck = mck(), gt = goalTable(), pos = 0, i;
    for (i = 0; i < gt.rows.length; i++) if (gt.rows[i][0] === m.home.name) pos = i + 1;
    var h = '<p class="eyebrow">Jugada clave · ' + gl.min + '\'</p><h2 style="margin-top:4px">¡Gol de ' + esc(m.home.name) + '!</h2><p class="sub">' + esc(m.home.name) + ' ' + ck.score[0] + ' – ' + ck.score[1] + ' ' + esc(m.away.name) + '</p>';
    h += '<p class="sec-h">Repetición desde otro ángulo</p>' + replayHtml(S.mAng || 0) + '<div class="chips rp-angs">';
    for (i = 0; i < ANGLES.length; i++) h += '<button data-act="mAng" data-i="' + i + '"' + ((S.mAng || 0) === i ? ' class="on"' : '') + '>' + ANGLES[i] + '</button>';
    h += '</div><p class="rp-desc">' + esc(gl.desc) + '</p>';
    h += '<p class="sec-h" style="margin-top:18px">El goleador</p><div class="scorer"><span class="num" style="background:' + m.home.color + '">' + gl.num + '</span><div class="grow"><div class="t">' + esc(gl.scorer) + '</div><div class="s">' + esc(gl.pos) + ' · ' + esc(m.home.name) + '</div>' +
      '<div class="nth">⚽ ' + esc(gl.line) + '</div></div></div><div class="tiles">';
    for (i = 0; i < gl.season.length; i++) h += '<div><b>' + gl.season[i][1] + '</b><span>' + gl.season[i][0] + '</span></div>';
    h += '</div>';
    h += '<p class="sec-h" style="margin-top:18px">Así cambia la tabla</p><p class="sub" style="margin-top:-2px">Si el partido terminara así, ' + esc(m.home.name) + ' sube al ' + pos + '.º lugar</p>' + tableHtml(gt.rows, gt.moves);
    h += '<button class="btn" data-act="closeSheet" style="margin-top:16px">Seguir viendo el partido</button>';
    send({ t: 'peek', what: 'la repetición del gol' });
    openSheet('mgoal', h);
  }
  function heatSvg(side) {
    var pts = C.MATCH.halftime.heat[side], col = side === 'home' ? '255,90,60' : '255,170,40', g = '', i;
    for (i = 0; i < pts.length; i++) g += '<circle cx="' + pts[i][0] * 3.2 + '" cy="' + pts[i][1] * 1.8 + '" r="' + (26 + pts[i][2] * 22) + '" fill="url(#hg' + side + ')" opacity="' + pts[i][2] + '"/>';
    return '<svg class="heat" viewBox="0 0 320 180" aria-label="Mapa de calor"><defs><radialGradient id="hg' + side + '"><stop offset="0" stop-color="rgb(' + col + ')" stop-opacity=".95"/><stop offset=".5" stop-color="rgb(' + col + ')" stop-opacity=".45"/><stop offset="1" stop-color="rgb(' + col + ')" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="320" height="180" fill="#2E7D49"/>' + g +
      '<g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"><rect x="6" y="6" width="308" height="168"/><line x1="160" y1="6" x2="160" y2="174"/><circle cx="160" cy="90" r="22"/><rect x="6" y="48" width="52" height="84"/><rect x="262" y="48" width="52" height="84"/></g></svg>';
  }
  function openHT() {
    var m = C.MATCH, H = m.halftime, ck = mck(), side = S.mHeat || 'home', i;
    var h = '<p class="eyebrow">Medio tiempo</p><h2 style="margin-top:4px">' + esc(m.home.name) + ' ' + ck.score[0] + ' – ' + ck.score[1] + ' ' + esc(m.away.name) + '</h2><p class="sub">Gol: ' + esc(m.goal.scorer) + ' ' + m.goal.min + '\'</p>';
    h += '<p class="sec-h">Resumen de estadísticas</p>' + statBars(H.stats);
    h += '<p class="sec-h" style="margin-top:18px">Mapa de calor</p><div class="seg2 mseg2"><button data-act="mHeat" data-t="home"' + (side === 'home' ? ' class="on"' : '') + '>' + esc(m.home.name) + '</button><button data-act="mHeat" data-t="away"' + (side === 'away' ? ' class="on"' : '') + '>' + esc(m.away.name) + '</button></div>' + heatSvg(side) +
      '<p class="rp-desc">' + (side === 'home' ? esc(m.home.name) + ' atacó sobre todo por la banda derecha →' : esc(m.away.name) + ' se replegó en su campo y buscó el contragolpe por el centro') + '</p>';
    var pl = H.plays[S.mPlay || 0];
    h += '<p class="sec-h" style="margin-top:18px">Mejores jugadas</p>' + replayHtml((S.mPlay || 0) === 0 ? 0 : (S.mPlay === 1 ? 1 : 2), pl[0] + ' ' + pl[1]);
    for (i = 0; i < H.plays.length; i++) h += '<button class="mrow play' + ((S.mPlay || 0) === i ? ' on' : '') + '" data-act="mPlay" data-i="' + i + '"><span class="pm">' + H.plays[i][0] + '</span><div class="grow"><div class="t">' + esc(H.plays[i][1]) + '</div><div class="s">' + esc(H.plays[i][2]) + '</div></div><span class="pi">▶</span></button>';
    h += '<p class="sec-h" style="margin-top:18px">Encuesta · jugador del primer tiempo</p>';
    if (S.mVote == null) {
      for (i = 0; i < H.poll.length; i++) h += '<button class="mrow vote" data-act="mVote" data-i="' + i + '"><div class="grow"><div class="t">' + esc(H.poll[i][0]) + '</div><div class="s">' + esc(H.poll[i][1]) + '</div></div><span class="pi">Votar</span></button>';
    } else {
      var tot = 0; for (i = 0; i < H.poll.length; i++) tot += H.poll[i][2] + (S.mVote === i ? 1 : 0);
      for (i = 0; i < H.poll.length; i++) { var pc = Math.round((H.poll[i][2] + (S.mVote === i ? 1 : 0)) / tot * 100);
        h += '<div class="pollr' + (S.mVote === i ? ' me' : '') + '"><i style="width:' + pc + '%"></i><span class="grow">' + esc(H.poll[i][0]) + (S.mVote === i ? ' · tu voto' : '') + '</span><b>' + pc + '%</b></div>'; }
      h += '<p class="rp-desc">Votaron 1,248 aficionados (resultados simulados)</p>';
    }
    h += '<p class="sec-h" style="margin-top:18px">Promociones de patrocinadores</p>';
    for (i = 0; i < H.sponsors.length; i++) { var sp = H.sponsors[i];
      h += '<div class="promo"><span class="pic" style="background:' + sp[4] + '">' + sp[0] + '</span><div class="grow"><div class="t">' + esc(sp[1]) + '</div><div class="s">' + esc(sp[2]) + '</div></div><button class="btn sm ghost" data-act="mPromo" data-i="' + i + '">' + esc(sp[3]) + '</button></div>'; }
    h += '<button class="btn" data-act="closeSheet" style="margin-top:16px">Listo</button>';
    openSheet('mht', h);
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
  /* La canción real se escucha en el servicio de música (no se reproduce aquí: tiene derechos) */
  function listenUrl(song) { return 'https://music.youtube.com/search?q=' + encodeURIComponent(song.t + ' ' + song.a + ' Sinners'); }
  /* Imagen real de Los Pecadores (TMDB) para miniaturas; mientras carga, el degradado de la escena */
  var SINP = { b: '', p: '', loading: false };
  function loadSin() {
    if (SINP.b || SINP.loading) return; SINP.loading = true;
    QV.http.get('https://api.themoviedb.org/3/search/movie?api_key=' + KEY + '&language=es-MX&query=' + encodeURIComponent(C.SERIES.tmdbQuery) + '&year=' + C.SERIES.tmdbYear, function (err, d) {
      var m = !err && d && d.results && d.results[0]; SINP.loading = false;
      if (m) { SINP.b = m.backdrop_path || ''; SINP.p = m.poster_path || ''; if (S.room) render(); }
    });
  }
  function sinArt(a, wide) {
    var path = wide ? SINP.b : (SINP.p || SINP.b);
    return path ? 'background:#000 url(https://image.tmdb.org/t/p/' + (wide ? 'w780' : 'w154') + path + ') center/cover no-repeat' : 'background:linear-gradient(150deg,' + a[0] + ',' + a[1] + ')';
  }
  function openProduct(prod) {
    $('sheet').innerHTML = '<div class="img"></div><p class="eyebrow" style="color:#7A4CC4">De la escena · Los Pecadores</p><h2 style="margin:4px 0 2px">' + esc(prod[0]) + '</h2><p style="color:#555;margin-bottom:16px">' + esc(prod[1]) + ' · Demo: compra no disponible en el prototipo</p><button class="btn" data-act="closeSheet">Listo</button>';
    $('sheet').hidden = false; $('scrim').hidden = false; S.sheet = 'product';
    send({ t: 'product', what: prod[0] });
  }

  /* ---------- v7.31 · Películas en tres momentos (bottom sheets) ----------
     1) al elegirla: la misma ficha del juego ¿Qué vemos? (título, sinopsis, duración, director, calificación, plataformas, reparto)
     2) al pausarla: información extra (datos de la película y, en Los Pecadores, lo que hay en la escena)
     3) al terminar: el soundtrack y películas recomendadas. Los datos salen de TMDB; si no hay internet, se usa lo local. */
  var MV = {
    series: { title: 'Los Pecadores', search: [C.SERIES.tmdbQuery, C.SERIES.tmdbYear],
      fallback: { overview: 'Mississippi, 1932. Los gemelos Smoke y Stack regresan a su pueblo para abrir un juke joint y empezar de nuevo, pero algo más oscuro los espera esa noche.', year: '2025', genres: 'Terror, Drama, Música', runtime: 137, director: 'Ryan Coogler',
        cast: [['Michael B. Jordan', 'Smoke y Stack'], ['Hailee Steinfeld', 'Mary'], ['Miles Caton', 'Sammie'], ["Jack O'Connell", 'Remmick'], ['Wunmi Mosaku', 'Annie'], ['Delroy Lindo', 'Delta Slim']] },
      extra: [['Música original', 'Ludwig Göransson'], ['Formato', 'Filmada en IMAX 65 mm y Ultra Panavision 70']],
      recs: [['Nosferatu', '2024'], ['Huye', '2017'], ['Pantera Negra', '2018']] },
    bunny: { title: 'Big Buck Bunny', id: 10378,
      fallback: { overview: 'Un conejo gigante y bonachón disfruta del bosque hasta que tres roedores empiezan a molestarlo. Es hora de darles una lección.', year: '2008', genres: 'Animación, Comedia, Familia', runtime: 10, director: 'Sacha Goedegebure', cast: [] },
      facts: ['Lo hizo en 2008 el Blender Institute, en Ámsterdam, como proyecto de la Blender Foundation.', 'Se creó completo con software libre: el programa de animación es Blender.', 'Su nombre clave durante la producción fue «Proyecto Peach».',
        'Tiene licencia Creative Commons: cualquiera puede usarlo y compartirlo, como en esta demo.', 'Los tres roedores que molestan al conejo se llaman Frank, Rinky y Gimera.'],
      songs: [{ t: 'Big Buck Bunny (música original)', a: 'Jan Morgenstern' }],
      recs: [['Sintel', '2010'], ['Elephants Dream', '2006'], ['Spring', '2019']] }
  };
  var MVD = {};   /* detalles de TMDB por película */
  function mvLoad(k, cb) {
    if (MVD[k]) return cb(MVD[k]);
    var m = MV[k], url = function (id) { return 'https://api.themoviedb.org/3/movie/' + id + '?api_key=' + KEY + '&language=es-MX&append_to_response=credits,watch/providers,recommendations'; };
    var got = function (err, d) { if (!err && d && d.id) MVD[k] = d; cb(MVD[k] || null); };
    if (m.id) return QV.http.get(url(m.id), got);
    QV.http.get('https://api.themoviedb.org/3/search/movie?api_key=' + KEY + '&language=es-MX&query=' + encodeURIComponent(m.search[0]) + '&year=' + m.search[1], function (err, d) {
      var r = !err && d && d.results && d.results[0]; if (!r) return cb(null); m.id = r.id; QV.http.get(url(r.id), got);
    });
  }
  var TP = 'https://image.tmdb.org/t/p/';
  function mvHead(k, d, eyebrow) {
    var m = MV[k], fb = m.fallback, t = d ? d.title : m.title, ot = d && d.original_title && d.original_title !== d.title ? d.original_title : '';
    var y = d ? (d.release_date || '').substring(0, 4) : fb.year, g = d ? (d.genres || []).map(function (x) { return x.name; }).slice(0, 3).join(', ') : fb.genres;
    var po = d && d.poster_path ? '<img class="mv-po" src="' + TP + 'w185' + d.poster_path + '" alt="">' : '<span class="mv-po ph">🎬</span>';
    return '<div class="mv-head">' + po + '<div><p class="eyebrow" style="color:#7A4CC4">' + eyebrow + '</p><h2>' + esc(t) + '</h2><p class="sub">' + esc([ot, y, g].filter(Boolean).join(' · ')) + '</p></div></div>';
  }
  function provChips(list) {
    var h = '<span class="mv-prov">';
    for (var i = 0; i < list.length; i++) h += '<span>' + (list[i].logo_path ? '<img src="' + TP + 'w92' + list[i].logo_path + '" alt="">' : '') + esc(list[i].provider_name) + '</span>';
    return h + '</span>';
  }
  /* 1) al elegir la película: la ficha del juego ¿Qué vemos? */
  function mvInfoHtml(k, d) {
    var m = MV[k], fb = m.fallback, h = mvHead(k, d, 'Estás viendo en la TV');
    h += '<p class="mv-syn">' + esc(d && d.overview ? d.overview : fb.overview) + '</p>';
    var rt = d ? d.runtime : fb.runtime, dir = d ? ((d.credits && d.credits.crew) || []).filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; }).slice(0, 2).join(', ') : fb.director;
    var mx = d && d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.MX || {}, flat = mx.flatrate || [];
    h += '<div class="mv-rows">' + (rt ? '<div><span>⏱</span>' + (rt >= 60 ? Math.floor(rt / 60) + ' h ' + (rt % 60) + ' min' : rt + ' min') + '</div>' : '') +
      (dir ? '<div><span>🎬</span>Dirigida por ' + esc(dir) + '</div>' : '') + (d && d.vote_average ? '<div><span>★</span>' + d.vote_average.toFixed(1) + ' de 10 en TMDB</div>' : '') +
      '<div><span>📺</span><span>' + (flat.length ? 'También disponible en ' + provChips(flat) : 'Disponible en Totalplay') + '</span></div></div>';
    var cast = d && d.credits ? d.credits.cast.slice(0, 10).map(function (p) { return [p.name, p.character]; }) : fb.cast;
    if (cast.length) {
      h += '<p class="lf">Reparto</p><div class="mv-cast">';
      for (var i = 0; i < cast.length; i++) h += '<div class="person"><span class="ph">' + esc(cast[i][0].charAt(0)) + '</span><b>' + esc(cast[i][0]) + '</b><small>' + esc(cast[i][1] || '') + '</small></div>';
      h += '</div>';
    }
    return h + '<button class="btn" data-act="closeSheet" style="margin-top:16px">Ver en la TV</button>';
  }
  /* 2) al pausar: información extra */
  function fmtDate(s2) { var p = (s2 || '').split('-'), mm = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']; return p.length === 3 ? Number(p[2]) + ' de ' + mm[Number(p[1]) - 1] + ' de ' + p[0] : ''; }
  function usd(n) { return n >= 1e6 ? 'US$' + Math.round(n / 1e6) + ' millones' : ''; }
  function mvExtraHtml(k, d) {
    var m = MV[k], h = mvHead(k, d, 'En pausa · ' + C.fmt(pos()));
    if (d && d.tagline) h += '<p class="mv-tag">«' + esc(d.tagline) + '»</p>';
    if (k === 'series') {
      var sc = sceneNow();
      h += '<p class="lf">En esta escena · ' + esc(sc.place) + '</p><div class="mv-list">';
      for (var i = 0; i < sc.cast.length; i++) h += '<div class="opt"><span class="ic">' + esc(sc.cast[i][1].charAt(0)) + '</span><span class="grow"><span class="t">' + esc(sc.cast[i][0]) + '</span><span class="s">' + esc(sc.cast[i][1]) + '</span></span></div>';
      h += '</div>';   /* la canción y el soundtrack salen al terminar la película, no al pausar */
    } else {
      h += '<p class="lf">Datos curiosos</p><div class="mv-list">';
      for (var f = 0; f < m.facts.length; f++) h += '<div class="opt"><span class="ic">' + (f + 1) + '</span><span class="grow"><span class="t" style="font-weight:600">' + esc(m.facts[f]) + '</span></span></div>';
      h += '</div>';
    }
    var rows = [];
    if (d) {
      if (d.release_date) rows.push(['Estreno', fmtDate(d.release_date)]);
      if (d.original_title && d.original_title !== d.title) rows.push(['Título original', d.original_title]);
      if (d.production_companies && d.production_companies.length) rows.push(['Producción', d.production_companies.slice(0, 2).map(function (x) { return x.name; }).join(', ')]);
      if (d.production_countries && d.production_countries.length) rows.push(['País', d.production_countries.map(function (x) { return x.name; }).slice(0, 2).join(', ')]);
      if (usd(d.budget)) rows.push(['Presupuesto', usd(d.budget)]);
      if (usd(d.revenue)) rows.push(['Taquilla mundial', usd(d.revenue)]);
    }
    rows = rows.concat(m.extra || []);
    if (rows.length) { h += '<p class="lf">Sobre la película</p><div class="mv-facts">'; for (var r = 0; r < rows.length; r++) h += '<div><span>' + esc(rows[r][0]) + '</span><b>' + esc(rows[r][1]) + '</b></div>'; h += '</div>'; }
    return h + '<button class="btn" data-act="play" style="margin-top:16px">▶  Seguir viendo</button><button class="mv-end" data-act="mvToEnd">Ir al final (demo)</button>';
  }
  /* 3) al terminar: soundtrack y recomendadas */
  function mvSongs(k) { if (k === 'bunny') return MV.bunny.songs; var l = [], sc = C.SERIES.scenes; for (var i = 0; i < sc.length; i++) l.push(sc[i].song); return l; }
  function mvEndHtml(k, d) {
    var m = MV[k], h = mvHead(k, d, 'Terminó en la TV'), songs = mvSongs(k);
    h += '<p class="lf">Soundtrack</p><div class="mv-list">';
    for (var i = 0; i < songs.length; i++) h += '<div class="opt"><span class="ic">♪</span><span class="grow"><span class="t">' + esc(songs[i].t) + '</span><span class="s">' + esc(songs[i].a) + '</span></span><button class="btn sm ghost" data-mvsong="' + k + ':' + i + '">Guardar</button></div>';
    h += '</div>' + (k === 'series' ? '<p class="sub" style="margin-top:6px">Música original de Ludwig Göransson.</p>' : '');
    var recs = d && d.recommendations && d.recommendations.results && d.recommendations.results.length ? d.recommendations.results.slice(0, 8).map(function (x) { return [x.title, (x.release_date || '').substring(0, 4), x.poster_path]; }) : m.recs;
    h += '<p class="lf">Películas recomendadas</p><div class="mv-recs">';
    for (var r = 0; r < recs.length; r++) h += '<button class="mv-rec" data-mvrec="' + esc(recs[r][0]) + '">' + (recs[r][2] ? '<img src="' + TP + 'w185' + recs[r][2] + '" alt="" loading="lazy">' : '<span class="ph">🎬</span>') + '<b>' + esc(recs[r][0]) + '</b><small>' + esc(recs[r][1] || '') + '</small></button>';
    return h + '</div><button class="btn" data-act="closeSheet" style="margin-top:16px">Listo</button>';
  }
  function mvOpen(kind, k) {
    var build = kind === 'info' ? mvInfoHtml : kind === 'extra' ? mvExtraHtml : mvEndHtml, name = 'mv-' + kind;
    openSheet(name, build(k, MVD[k] || null)); S.mvK2 = k; buzz();
    if (!MVD[k]) mvLoad(k, function (d) { if (d && S.sheet === name) { var t = $('sheet').scrollTop; openSheet(name, build(k, d)); $('sheet').scrollTop = t; } });
  }
  /* cuándo sale cada hoja: al empezar la película, al pausarla y cuando la TV avisa que terminó */
  function mvWatch(r) {
    var k = r.screen === 'player' && r.content === 'series' ? 'series' : r.screen === 'player' && r.content === 'video' ? 'bunny' : '';
    if (S.mvK === undefined) { S.mvK = k; S.mvPlay = r.playing; S.finSeen = r.fin ? r.fin.seq : 0; return; }
    if (k && k !== S.mvK) mvOpen('info', k);
    else if (k && S.mvPlay && !r.playing) {
      var nearEnd = k === 'bunny' ? pos() >= C.BUNNY.dur - 1.5 : pos() >= C.SERIES.duration - 2;
      if (!nearEnd) mvOpen('extra', k);
    }
    if (S.sheet === 'mv-extra' && r.playing) closeSheet();   /* al reanudar se cierra sola */
    if (r.fin && r.fin.seq !== S.finSeen) { S.finSeen = r.fin.seq; mvOpen('end', r.fin.id); }
    S.mvK = k; S.mvPlay = r.playing;
  }

  /* ---------- sugerencia al pausar un canal ---------- */
  var KEY = 'a7795e812c110c40515e414ceb379fac';
  function money(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tmdbPoster(id, cb) {
    QV.http.get('https://api.themoviedb.org/3/movie/' + id + '?api_key=' + KEY + '&language=es-MX', function (err, d) { if (!err && d) cb(d); });
  }
  /* Al pausar en la TV llega una sugerencia distinta según lo que se está viendo */
  function showOffer(o) {
    if (o.ch === 'match') { openMatchSheet(); buzz(); setTimeout(buzz, 180); return; }
    var ch = C.offerSource(o.ch); if (!ch || !ch.offer) return;
    var of = ch.offer, b = $('banner'), k, t, s, btn;
    if (of.kind === 'rent') { k = 'Estabas viendo ' + ch.show; t = of.title + ' ya está en On Demand'; s = 'Renta por 48 horas · $' + of.price + ' MXN'; btn = 'Rentar y ver en la TV'; }
    else if (of.kind === 'anytime') { k = 'Pausaste ' + ch.show; t = of.line; s = 'Disponible en Anytime · desde el inicio'; btn = 'Ver en la TV'; }
    else if (of.kind === 'delivery') { k = 'Estabas viendo ' + ch.show; t = '¿Se antoja una pizza como la de Kevin?'; s = 'Pídela desde aquí sin dejar la película · ' + of.place; btn = 'Pedir pizza'; }
    else if (of.kind === 'facts') { k = 'Pausaste ' + ch.show; t = of.facts.length + ' datos curiosos de la película'; s = 'Para leer mientras está en pausa'; btn = 'Ver datos'; }
    else { k = 'Estabas viendo ' + ch.show; t = 'Compra el look de ' + of.who; s = of.products.length + ' prendas de la película en Shop'; btn = 'Ver en Shop'; }
    b.className = 'banner offer';
    b.innerHTML = '<span class="poster" id="ofPoster"></span><div class="grow"><div class="k">' + esc(k) + '</div><div class="t">' + esc(t) + '</div><div class="s">' + esc(s) + '</div></div>' +
      '<div class="row"><button data-act="offerGo" data-ch="' + ch.n + '">' + esc(btn) + '</button><button class="g" data-act="closeBanner">Ahora no</button></div>';
    b.hidden = false; buzz(); setTimeout(buzz, 180);
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { b.hidden = true; }, 30000);
    var pid = of.kind === 'rent' ? of.tmdb : ch.tmdb;
    $('ofPoster').style.background = 'linear-gradient(150deg,' + ch.art[0] + ',' + ch.art[1] + ')';
    if (pid) tmdbPoster(pid, function (d) {
      var p = $('ofPoster'); if (d.poster_path && p) p.style.background = '#EEE url(https://image.tmdb.org/t/p/w154' + d.poster_path + ') center/cover';
      if (of.kind === 'rent' && d.title && b.querySelector('.t')) b.querySelector('.t').textContent = d.title + ' ya está en On Demand';
    });
  }
  function offerGo(id) {
    var ch = C.offerSource(id); if (!ch) return;
    var of = ch.offer;
    $('banner').hidden = true;
    if (of.kind === 'rent' || of.kind === 'anytime') { send({ t: 'offer', ch: ch.n }); toast(of.kind === 'rent' ? 'Confirma la renta en la TV con OK' : 'Abriendo en la TV desde el inicio'); return; }
    if (of.kind === 'facts') { openFactsList(ch); send({ t: 'notice', text: '📱 ' + S.name + ' está leyendo datos curiosos de ' + ch.show }); return; }
    if (of.kind === 'delivery') { S.cart = {}; openDelivery(ch); return; }
    if (of.kind === 'shop') { S.bag = {}; openShop(ch); }
  }
  /* Datos curiosos (pausa en Clásicos 7) */
  function openFactsList(ch, i) {
    var f = ch.offer.facts; i = i || 0;
    var d = ''; for (var k = 0; k < f.length; k++) d += '<i class="' + (k === i ? 'on' : '') + '"></i>';
    openSheet('factsList', '<p class="eyebrow" style="color:#7A4CC4">Mientras está en pausa</p><h2>Datos curiosos de ' + esc(ch.show) + '</h2><p class="sub">Dato ' + (i + 1) + ' de ' + f.length + '</p>' +
      '<div class="fact"><span class="fn">' + (i + 1) + '/' + f.length + '</span>' + esc(f[i]) + '</div><div class="dots">' + d + '</div>' +
      '<div class="pairb" style="margin-top:12px">' + (i > 0 ? '<button class="btn ghost" data-act="factPrev" data-ch="' + ch.n + '" data-i="' + i + '">Anterior</button>' : '<button class="btn ghost" data-act="closeSheet">Cerrar</button>') +
      (i < f.length - 1 ? '<button class="btn" data-act="factNext" data-ch="' + ch.n + '" data-i="' + i + '">Siguiente</button>' : '<button class="btn" data-act="factPlay">Seguir viendo</button>') + '</div>');
  }
  /* Delivery (pausa en Familia 5) */
  function cartTotal(menu, cart) { var t = 0, n = 0; for (var i = 0; i < menu.length; i++) { var q = cart[menu[i].id] || 0; t += q * menu[i].p; n += q; } return { t: t, n: n }; }
  function openDelivery(ch) {
    var of = ch.offer, html = '<p class="eyebrow" style="color:#7A4CC4">Delivery · ' + esc(of.place) + '</p><h2>Pide sin pausar la película</h2><p class="sub">Llega en unos ' + of.eta + ' minutos.</p>';
    for (var i = 0; i < of.menu.length; i++) {
      var m = of.menu[i], q = S.cart[m.id] || 0;
      html += '<div class="opt"><span class="ic">' + m.ic + '</span><span class="grow"><span class="t">' + esc(m.n) + '</span><span class="s" style="display:block">' + esc(m.d) + ' · ' + money(m.p) + '</span></span>' +
        '<span class="qty"><button data-qty="-1" data-id="' + m.id + '" data-ch="' + ch.n + '">−</button><b>' + q + '</b><button data-qty="1" data-id="' + m.id + '" data-ch="' + ch.n + '">＋</button></span></div>';
    }
    var tot = cartTotal(of.menu, S.cart);
    html += '<button class="btn" data-act="orderGo" data-ch="' + ch.n + '"' + (tot.n ? '' : ' disabled style="opacity:.45"') + '>' + (tot.n ? 'Pedir ' + tot.n + ' · ' + money(tot.t + 29) + ' con envío' : 'Elige qué se te antoja') + '</button>';
    openSheet('delivery', html);
  }
  /* Shop (pausa en Estilo 9) */
  function openShop(ch) {
    var of = ch.offer, html = '<p class="eyebrow" style="color:#7A4CC4">Shop · de la escena</p><h2>El look de ' + esc(of.who) + '</h2><p class="sub">Prendas como las que salen en ' + esc(ch.show) + '.</p>';
    for (var i = 0; i < of.products.length; i++) {
      var pr = of.products[i], inBag = S.bag[i];
      html += '<div class="opt"><span class="ic" style="background:linear-gradient(150deg,' + pr.c[0] + ',' + pr.c[1] + ');font-size:22px">' + pr.ic + '</span><span class="grow"><span class="t">' + esc(pr.n) + '</span><span class="s" style="display:block">' + esc(pr.d) + ' · ' + money(pr.p) + '</span></span>' +
        '<button class="chipb' + (inBag ? ' on' : '') + '" data-bag="' + i + '" data-ch="' + ch.n + '">' + (inBag ? '✓ En bolsa' : 'Agregar') + '</button></div>';
    }
    var t = 0, n = 0; for (var k in S.bag) if (S.bag.hasOwnProperty(k) && S.bag[k]) { t += of.products[k].p; n++; }
    html += '<button class="btn" data-act="buyGo" data-ch="' + ch.n + '"' + (n ? '' : ' disabled style="opacity:.45"') + '>' + (n ? 'Comprar ' + n + ' · ' + money(t) : 'Agrega algo a tu bolsa') + '</button><p class="sub" style="text-align:center;margin-top:8px">Demo: no se hace ningún cargo.</p>';
    openSheet('shop', html);
  }
  function doneSheet(icon, title, sub) {
    openSheet('done', '<div style="text-align:center;padding:10px 0"><div style="font-size:54px">' + icon + '</div><h2 style="margin-top:6px">' + esc(title) + '</h2><p class="sub">' + esc(sub) + '</p></div>' +
      '<button class="btn" data-act="factPlay">Seguir viendo</button>');
    buzz(); setTimeout(buzz, 160);
  }

  /* ---------- Recetas: ingredientes y compra en supermercados de Shop Totalplay, sin pausar la TV ---------- */
  function showRecipeBanner() {
    var RC = C.RECIPE, b = $('banner');
    b.className = 'banner offer';
    b.innerHTML = '<span class="poster" style="background:#3E7A3A url(' + C.PHOTOS.recipe + '200) center/cover"></span><div class="grow"><div class="k">Te llegó la receta</div><div class="t">' + esc(RC.dish) + '</div><div class="s">' + RC.ingredients.length + ' ingredientes · cómpralos en Shop sin pausar la TV</div></div>' +
      '<div class="row"><button data-act="recipe">Ver receta e ingredientes</button><button class="g" data-act="closeBanner">Luego</button></div>';
    b.hidden = false; buzz(); setTimeout(buzz, 180);
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { b.hidden = true; }, 25000);
  }
  function rcTotal() {
    var RC = C.RECIPE, st = RC.stores[S.rcStore || 0], t = 0, n = 0;
    for (var i = 0; i < RC.ingredients.length; i++) if (S.rcSel[i]) { t += Math.round(RC.ingredients[i].p * st.f); n++; }
    return { t: t, n: n, st: st };
  }
  function openRecipe() {
    var RC = C.RECIPE, tab = S.rcTab || 'ing';
    if (!S.rcSel) { S.rcSel = []; for (var i = 0; i < RC.ingredients.length; i++) S.rcSel.push(true); S.rcStore = 0; }
    var html = '<p class="eyebrow" style="color:#7A4CC4">Receta · se sigue viendo en la TV</p><h2>' + esc(RC.dish) + '</h2><p class="sub">Para 4 personas · 25 min</p>' +
      '<div class="seg2"><button class="' + (tab === 'ing' ? 'on' : '') + '" data-rctab="ing">Ingredientes</button><button class="' + (tab === 'pasos' ? 'on' : '') + '" data-rctab="pasos">Pasos</button></div>';
    if (tab === 'pasos') {
      var cur = (S.room && S.room.recipeStep) || 0; S.rcStepShown = cur;
      for (var k = 0; k < RC.steps.length; k++) html += '<div class="opt' + (k === cur ? ' on' : '') + '"><span class="ic">' + RC.steps[k].ic + '</span><span class="grow">' + (k === cur ? '<span class="nowtv">▶ En la TV ahora</span>' : '') + '<span class="t">' + (k + 1) + '. ' + esc(RC.steps[k].t) + '</span><span class="s" style="display:block">' + esc(RC.steps[k].d) + '</span></span></div>';
      openSheet('recipe', html); return;
    }
    var st = RC.stores[S.rcStore || 0];
    for (var j = 0; j < RC.ingredients.length; j++) {
      var it = RC.ingredients[j], on = S.rcSel[j];
      html += '<button class="opt ing' + (on ? ' on' : '') + '" data-ing="' + j + '"><span class="ck2">' + (on ? '✓' : '') + '</span><span class="ic">' + it.ic + '</span><span class="grow"><span class="t">' + esc(it.n) + '</span><span class="s" style="display:block">' + esc(it.q) + '</span></span><b class="pr">' + money(Math.round(it.p * st.f)) + '</b></button>';
    }
    html += '<p class="lf">Surtir en un supermercado de Shop Totalplay</p><div class="stores">';
    for (var s2 = 0; s2 < RC.stores.length; s2++) html += '<button class="' + (s2 === (S.rcStore || 0) ? 'on' : '') + '" data-store="' + s2 + '"><b>' + esc(RC.stores[s2].n) + '</b><small>Llega en ' + esc(RC.stores[s2].eta) + '</small></button>';
    var tot = rcTotal();
    html += '</div><p class="sub" style="margin:10px 0 8px">¿Ya tienes algo? Quítale la palomita.</p>' +
      '<button class="btn" data-act="rcBuy"' + (tot.n ? '' : ' disabled style="opacity:.45"') + '>' + (tot.n ? 'Comprar ' + tot.n + ' ingredientes · ' + money(tot.t + RC.ship) : 'Elige al menos un ingrediente') + '</button>' +
      '<p class="sub" style="text-align:center;margin-top:8px">Incluye envío de $' + RC.ship + ' · Demo: no se hace ningún cargo.</p>';
    openSheet('recipe', html);
  }

  /* ---------- Nave espacial: control clásico (cruceta, A, B, Start) ---------- */
  var P2 = { up: false, down: false, left: false, right: false, a: false, b: false, sent: '' };
  function p2Send() {
    var c = { t: 'ship', dx: (P2.right ? 1 : 0) - (P2.left ? 1 : 0), dy: (P2.down ? 1 : 0) - (P2.up ? 1 : 0), a: P2.a, b: P2.b }, k = [c.dx, c.dy, c.a, c.b].join();
    if (k === P2.sent) return; P2.sent = k; send(c);
  }
  function p2Reset() { P2.up = P2.down = P2.left = P2.right = P2.a = P2.b = false; var on = document.querySelectorAll('#pad2 .on'); for (var i = 0; i < on.length; i++) on[i].classList.remove('on'); p2Send(); }
  (function wireP2() {
    var bs = document.querySelectorAll('#pad2 [data-d],#pad2 [data-p2]');
    for (var i = 0; i < bs.length; i++) (function (b) {
      var key = b.getAttribute('data-d') || b.getAttribute('data-p2');
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); tryLandscape();
        if (key === 'start') { buzz(); send({ t: 'shipStart' }); b.classList.add('on'); setTimeout(function () { b.classList.remove('on'); }, 150); return; }
        P2[key] = true; b.classList.add('on'); buzz(); p2Send();
      });
      var up = function () { if (key === 'start' || !P2[key]) return; P2[key] = false; b.classList.remove('on'); p2Send(); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    })(bs[i]);
  })();
  var triedLand = false;
  function tryLandscape() {
    if (triedLand) return; triedLand = true;
    try {
      var el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rq && screen.orientation && screen.orientation.lock) { var p = rq.call(el); if (p && p.then) p.then(function () { return screen.orientation.lock('landscape'); }).catch(function () {}); }
    } catch (e) { /* iPhone: se gira a mano */ }
  }
  function leaveLandscape() {
    triedLand = false;
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* ignore */ }
  }
  /* Tamaño real visible (en iPhone 100vh incluye la barra de Safari y cortaba el control): se mide con innerWidth/innerHeight.
     En vertical el control se dibuja girado para usar el celular de lado. */
  function sizePad2() {
    var el = $('pad2').firstElementChild, w = window.innerWidth, h = window.innerHeight;
    if (h > w) { el.style.width = h + 'px'; el.style.height = w + 'px'; el.style.transform = 'translateX(' + w + 'px) rotate(90deg)'; el.classList.add('rot'); }
    else { el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.transform = 'none'; el.classList.remove('rot'); }
  }
  window.addEventListener('resize', function () { if (!$('pad2').hidden) sizePad2(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { if (!$('pad2').hidden) sizePad2(); }, 250); });
  function renderPad2() {
    var r = S.room, sh = r.ship || {}, on = r.screen === 'ship' && (sh.state === 'running' || sh.state === 'paused' || sh.state === 'over');
    var was = !$('pad2').hidden;
    $('pad2').hidden = !on;
    if (!on) { if (was) { p2Reset(); leaveLandscape(); } return; }
    $('tabs').style.display = 'none';
    if (!was) sizePad2();
    var scores = sh.scores || {}, mine = scores[S.pid] || 0;
    $('p2Me').innerHTML = '<span class="av" style="background:' + ((sh.colors && sh.colors[S.pid]) || COLORS[0]) + '">' + esc((S.name || '?').charAt(0).toUpperCase()) + '</span>' + esc(S.name);
    $('p2Pts').textContent = mine;
    var left = Math.max(0, Math.ceil((sh.state === 'paused' ? (sh.left || 0) : (sh.endsAt || 0) - Date.now()) / 1000));
    $('p2Info').textContent = sh.state === 'running' ? 'Quedan ' + left + ' s' : sh.state === 'paused' ? 'En pausa · Start para seguir' : 'Fin · hiciste ' + mine + ' puntos';
    $('p2Over').hidden = sh.state !== 'over';
    if (sh.state === 'over' && (P2.a || P2.b || P2.up || P2.down || P2.left || P2.right)) p2Reset();
  }

  /* ---------- hojas (modales): no tapan el control, se cierran deslizando al fondo o con ✕ ---------- */
  function openSheet(name, html) {
    S.sheet = name;
    $('sheet').className = 'sheet' + (name === 'unlink' ? ' dark' : /^(match|mpre|mgoal|mht)$/.test(name) ? ' sport' : '');
    $('sheet').innerHTML = '<button class="x" data-act="closeSheet" aria-label="Cerrar">✕</button>' + html;
    $('sheet').hidden = false; $('scrim').hidden = false; $('sheet').scrollTop = 0;
  }
  function closeSheet() {
    S.sheet = null; $('sheet').hidden = true; $('scrim').hidden = true;
  }

  /* ---------- v7.19 · Decodificadores: lista con controlar, vincular, renombrar, desvincular, principal y agregar ----------
     Las TVs reales son las que este celular escaneó (QR); Recámara/Estudio/Terraza y las que agregues son simuladas. */
  var DKEY = 'cp-decs' + (CP.DEMO ? '-demo' : ''), RKEY = 'cp-rooms' + (CP.DEMO ? '-demo' : '');
  var FAKE_BY = {}, DEC_ST = {};
  var OK_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var X_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var PEN_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.8 7l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  var STAR_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function decs() {
    var list = lsJSON(DKEY, null), rooms = lsJSON(RKEY, []), have = {}, i;
    if (!list) { list = []; for (i = 0; i < FAKES.length; i++) list.push({ id: 'f' + i, kind: 'fake', fi: i, name: FAKES[i].name, linked: true }); }
    for (i = 0; i < list.length; i++) have[list[i].id] = true;
    for (i = rooms.length - 1; i >= 0; i--) if (!have['r' + rooms[i].code]) list.unshift({ id: 'r' + rooms[i].code, kind: 'real', code: rooms[i].code, name: rooms[i].name, linked: true });
    var main = null; for (i = 0; i < list.length; i++) if (list[i].main) { if (main || !list[i].linked) list[i].main = false; else main = list[i]; }
    if (!main) for (i = 0; i < list.length; i++) if (list[i].linked) { list[i].main = true; break; }
    return list;
  }
  function saveDecs(list) { ls.set(DKEY, JSON.stringify(list)); }
  function decById(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function decUpdate(id, fn) { var l = decs(), d = decById(l, id); if (d) { fn(d, l); saveDecs(l); } return d; }
  function curDecId() { return S.fake ? S.fakeId : 'r' + S.code; }
  function realAlias(code) { var d = decById(decs(), 'r' + code); return d ? d.name : null; }
  function fakeFor(d) {
    var f = d.kind === 'fake' ? FAKES[d.fi] : (FAKE_BY[d.id] || (FAKE_BY[d.id] = { name: d.name, state: 'on', vol: 30 }));
    f.name = d.name; return f;
  }
  function decState(d) {
    if (!d.linked) return 'unlinked';
    if (d.kind === 'real') return DEC_ST[d.code] || (!S.fake && d.code === S.code ? tvState() : 'on');
    return fakeFor(d).state;
  }
  var DEC_TXT = { on: 'Conectado', sleep: 'En reposo', off: 'Desconectado', unlinked: 'No vinculado' };
  function renderDecs() {
    var list = decs(), cur = curDecId(), anyLinked = false, html = '', i;
    list.sort(function (a, b) { return (b.main ? 1 : 0) - (a.main ? 1 : 0); });
    for (i = 0; i < list.length; i++) if (list[i].linked) anyLinked = true;
    /* v7.22 · solo flecha + sección; texto guía; búsqueda tipo Bluetooth (lo que encuentra aparece en la lista) */
    html += '<div class="dv-bar"><button class="dv-back" data-act="decsBack" aria-label="Regresar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="dv-title">Decodificadores</span><span></span></div>' +
      '<p class="dv-hint">Vincula tu control a un decodificador Totalplay</p>';
    if (!anyLinked) html += '<div class="dv-empty">No tienes decodificadores vinculados. Vincula uno para usar el control.</div>';
    for (i = 0; i < list.length; i++) {
      var d = list[i], st = decState(d), isCur = d.linked && d.id === cur && !S.noDec;
      /* v7.20 · nombre + lápiz (renombrar) + estrella (principal); estado abajo; Desvincular/Vincular a la derecha */
      var editing = S.decEdit === d.id;
      html += '<div class="dcard' + (isCur ? ' cur' : '') + (d.linked ? '' : ' unl') + (editing ? ' editing' : '') + '">' +
        (editing ? '<div class="dinfo">' : '<div class="dinfo" data-dpick="' + d.id + '" role="button" aria-label="Controlar ' + esc(d.name) + '">') +
          (editing
            ? '<div class="dline"><input class="dname-in" id="decNameIn" maxlength="20" value="' + esc(d.name) + '" autocomplete="off" aria-label="Nombre del decodificador">' +
              '<button class="dic-b ok" data-rsave="' + d.id + '" aria-label="Guardar nombre">' + OK_IC + '</button><button class="dic-b" data-act="renCancel" aria-label="Cancelar">' + X_IC + '</button></div>'
            : '<div class="dline"><span class="dname">' + esc(d.name) + '</span>' +
              '<button class="dic-b" data-dren="' + d.id + '" aria-label="Editar nombre">' + PEN_IC + '</button>' +
              '<button class="dic-b star' + (d.main ? ' on' : '') + '" data-dmain="' + d.id + '" aria-label="' + (d.main ? 'Es tu principal' : 'Hacer principal') + '"' + (d.linked ? '' : ' disabled') + '>' + STAR_IC + '</button></div>') +
          '<span class="s"><span class="sdot ' + (st === 'on' ? '' : st === 'unlinked' ? 'off' : st) + '" id="dst-' + d.id + '"></span><span id="dsx-' + d.id + '">' + DEC_TXT[st] + '</span>' +
          (isCur ? ' · Controlando' : '') + (d.kind === 'real' ? '' : ' · Simulado') + '</span>' +
        '</div>' +
        (d.linked ? '<button class="dcta warn" data-dunl="' + d.id + '">Desvincular</button>' : '<button class="dcta pri" data-dlink="' + d.id + '">Vincular</button>') +
        '</div>';
    }
    html += S.decScan ? '<div class="dv-scan"><span class="spin"></span>Buscando decodificadores cercanos…</div>'
      : '<div class="dv-scan done">' + '<span>' + (S.decFound ? 'Se encontró ' + esc(S.decFound) + ' cerca de ti' : 'No hay más decodificadores cerca') + '</span><button data-act="decScan">Buscar de nuevo</button></div>';
    $('decsView').innerHTML = html;
    if (S.decEdit && $('decNameIn')) { var ni = $('decNameIn'); ni.focus(); try { ni.setSelectionRange(ni.value.length, ni.value.length); } catch (e) { /* ignore */ }
      ni.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); saveRename(S.decEdit); } else if (e.key === 'Escape') { S.decEdit = null; renderDecs(); } }; }
    for (i = 0; i < list.length; i++) if (list[i].kind === 'real' && list[i].linked) (function (d) {
      store.getRoom(d.code, function (err, room) {
        var st = 'off';
        if (!err && room) st = (room.aliveAt && Date.now() - room.aliveAt > ALIVE_MS) ? 'off' : (room.off ? 'sleep' : 'on');
        DEC_ST[d.code] = st;
        var sx = $('dsx-' + d.id), sd = $('dst-' + d.id); if (!sx) return;
        sx.textContent = err ? 'Sin conexión' : (!room ? 'Ya no está disponible' : DEC_TXT[st]); sd.className = 'sdot ' + (st === 'on' ? '' : st);
      });
    })(list[i]);
  }
  function openDecoders() { closeSheet(); setTab('decs'); }
  function pickDec(id, silent) {
    var d = decById(decs(), id); if (!d) return;
    if (!d.linked) { toast('Primero vincula ' + d.name, true); return; }
    if (decState(d) === 'off') { toast(d.name + ' está desconectado', true); return; }
    S.noDec = false;
    if (d.kind === 'real') {
      if (!S.fake && d.code === S.code) { setTab('control'); return; }
      S.fake = null; S.fakeId = null; connect(d.code, true); setTab('control'); return;
    }
    S.fake = fakeFor(d); S.fakeId = d.id; setTab('control');
    if (!silent) toast('Controlando ' + d.name + ' (simulado)');
  }
  function setMain(id) {
    var cur = decById(decs(), id); if (cur && cur.main) { toast(cur.name + ' ya es tu principal'); return; }
    var d = decUpdate(id, function (x, l) { for (var i = 0; i < l.length; i++) l[i].main = false; x.main = true; });
    renderDecs(); if (d) toast('★ ' + d.name + ' ahora es tu principal');
  }
  function saveRename(id) {
    var nm = ($('decNameIn').value || '').trim().substring(0, 20); if (!nm) { toast('Escribe un nombre', true); return; }
    var d = decUpdate(id, function (x) { x.name = nm; });
    if (d && d.kind !== 'real') fakeFor(d);
    S.decEdit = null; renderDecs(); renderHeader(); toast('Listo: ahora se llama ' + nm);
  }
  function askUnlink(id) {
    var d = decById(decs(), id); if (!d) return;
    openSheet('unlink', '<h2>¿Desvincular ' + esc(d.name) + '?</h2><p class="sub">Ya no podrás controlarlo desde este celular hasta que lo vuelvas a vincular.</p>' +
      '<button class="btn warn" data-act="unlinkOk" data-id="' + id + '">Desvincular</button><button class="btn ghost" data-act="closeSheet" style="margin-top:8px">Cancelar</button>');
  }
  function doUnlink(id) {
    var wasCur = id === curDecId() && !S.noDec;
    var d = decUpdate(id, function (x) { x.linked = false; x.main = false; });
    var list = decs(); saveDecs(list);   /* reasigna la principal */
    closeSheet();
    if (wasCur) {
      var next = null; for (var i = 0; i < list.length; i++) if (list[i].linked && list[i].main) next = list[i];
      if (!next) for (var j = 0; j < list.length; j++) if (list[j].linked && decState(list[j]) !== 'off') { next = list[j]; break; }
      if (next) { pickDec(next.id, true); setTab('decs'); toast((d ? d.name : '') + ' desvinculado · ahora controlas ' + next.name); return; }
      S.noDec = true;
    }
    renderDecs(); toast((d ? d.name : 'Decodificador') + ' desvinculado');
  }
  function doLink(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Vinculando…'; }
    setTimeout(function () {
      var d = decUpdate(id, function (x) { x.linked = true; });
      saveDecs(decs());
      if (S.noDec && d) { pickDec(d.id, true); setTab('decs'); }
      renderDecs(); if (d) { buzz(); toast('✓ Vinculado con ' + d.name); }
    }, 1200);
  }
  /* Búsqueda simulada: como Bluetooth, los decodificadores cercanos aparecen solos en la lista (sin vincular) */
  var NEARBY = [{ id: 'nCocina', name: 'Cocina' }, { id: 'nVisitas', name: 'Cuarto de visitas' }];
  function scanDecs() {
    if (S.decScan) return;
    S.decScan = true; S.decFound = null; renderDecs();
    setTimeout(function () {
      var l = decs(), found = null;
      for (var i = 0; i < NEARBY.length && !found; i++) if (!decById(l, NEARBY[i].id)) { found = NEARBY[i]; l.push({ id: found.id, kind: 'new', name: found.name, linked: false }); }
      saveDecs(l); S.decScan = false; S.decFound = found ? found.name : null;
      if (S.tab === 'decs') { renderDecs(); if (found) buzz(); }
    }, 2400);
  }

  /* ---------- v7.19 · Configuración (engrane del encabezado): apps favoritas, preferencias del control y apariencia ---------- */
  var FKEY = 'cp-favs', FAV_DEF = ['netflix', 'prime', 'youtube', 'ondemand'], FAV_MAX = 4;   /* el control muestra 4 */
  var PREF = lsJSON('cp-prefs', { vib: true, touch: true });
  function favs() { var f = lsJSON(FKEY, null); if (!f) f = FAV_DEF.slice(); return f.filter(function (id) { return !!APP_NAMES[id]; }).slice(0, FAV_MAX); }
  function appTile(id) { return '<button data-app="' + id + '" style="--c:' + appColor(id) + '" aria-label="' + esc(APP_NAMES[id]) + '"><span class="nm">' + esc(APP_NAMES[id]) + '</span></button>'; }
  function renderApps() {
    var f = favs(), html = ''; for (var i = 0; i < f.length; i++) html += appTile(f[i]);
    var row = $('appsRow'); row.innerHTML = html;
    paintAppLogos();
  }
  /* v7.23 · Configuración es una pantalla completa: flecha de regreso + nombre de la sección (sin encabezado del control) */
  function cfgBar(title, back) {
    return '<div class="dv-bar"><button class="dv-back" data-act="' + back + '" aria-label="Regresar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="dv-title">' + title + '</span><span></span></div>';
  }
  function cfgShow(page, html) {
    S.cfgPage = page; closeSheet();
    $('cfgView').innerHTML = html;
    if (S.tab !== 'cfg') setTab('cfg'); else window.scrollTo(0, 0);
  }
  function setRow(act, ic, t, sub) {
    return '<button class="set-row" data-act="' + act + '"><span class="set-ic">' + ic + '</span><span class="grow"><span class="t">' + t + '</span><span class="s">' + sub + '</span></span><span class="go">›</span></button>';
  }
  function openSettings() {
    var th = { dark: 'Oscuro', light: 'Claro', auto: 'Automático' }[themeMode()];
    cfgShow('main', cfgBar('Configuración', 'cfgClose') + '<div class="cfg-list">' +
      setRow('setApps', '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16.75 13.8v6M13.75 16.8h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
        'Aplicaciones favoritas', 'Elige hasta ' + FAV_MAX + ' · ' + favs().length + ' de ' + FAV_MAX + ' elegidas') +
      setRow('setPrefs', '<svg viewBox="0 0 24 24"><rect x="7.5" y="3" width="9" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 9v6M20 9v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
        'Preferencias del control', 'Vibración ' + (PREF.vib ? 'activada' : 'desactivada') + ' · respuesta táctil ' + (PREF.touch ? 'activada' : 'desactivada')) +
      setRow('setLook', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
        'Apariencia', 'Tema ' + th.toLowerCase()) +
      '</div>' + (S.fake ? '' : '<button class="set-link" data-act="ahoraGo">Ver lo que está en la TV ›</button>'));
  }
  /* v7.24 · todas las apps con Agregar / Quitar (como los decodificadores); máximo 4; contador abajo */
  function openFavs() {
    var f = favs(), full = f.length >= FAV_MAX, html = cfgBar('Aplicaciones favoritas', 'settings') + '<p class="dv-hint">Agrega tus apps favoritas</p><div class="fav-list">';
    for (var j = 0; j < C.APPS.length; j++) {
      var id = C.APPS[j].id, on = f.indexOf(id) >= 0;
      html += '<div class="fav-row' + (on ? ' on' : '') + '"><span class="fav-ic" style="background:' + appColor(id) + '">' + (CP.logos.img(id, 'w92', 'logo') || '') + '</span><span class="grow">' + esc(APP_NAMES[id]) + '</span>' +
        (on ? '<button class="dcta warn" data-fdel="' + f.indexOf(id) + '">Quitar</button>' : '<button class="dcta pri" data-fadd="' + id + '"' + (full ? ' disabled' : '') + '>Agregar</button>') + '</div>';
    }
    html += '</div><div class="fav-foot"><span>Elige ' + FAV_MAX + '</span><span class="fav-count' + (full ? ' full' : '') + '">' + f.length + ' de ' + FAV_MAX + (full ? ' · listo' : '') + '</span></div>';
    var keep = window.scrollY; cfgShow('favs', html); window.scrollTo(0, keep);
  }
  function favEdit(fn) { var f = favs(); fn(f); ls.set(FKEY, JSON.stringify(f)); renderApps(); openFavs(); }
  function sw(key, t, sub) { return '<button class="set-row sw-row" data-pref="' + key + '"><span class="grow"><span class="t">' + t + '</span><span class="s">' + sub + '</span></span><span class="sw' + (PREF[key] ? ' on' : '') + '"><i></i></span></button>'; }
  function openPrefs() {
    cfgShow('prefs', cfgBar('Preferencias del control', 'settings') + '<div class="cfg-list">' +
      sw('vib', 'Vibración', 'El celular vibra al tocar un botón y con los avisos') +
      sw('touch', 'Respuesta táctil', 'Los botones se iluminan al presionarlos') + '</div>');
  }
  function themeMode() { var m = ls.get('cp-theme'); return m === 'light' || m === 'auto' ? m : 'dark'; }
  var mqLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    var m = themeMode(), light = m === 'light' || (m === 'auto' && mqLight && mqLight.matches);
    document.body.classList.toggle('light', !!light);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', light ? '#F4F0FA' : '#140F20');
  }
  if (mqLight) { var onMq = function () { if (themeMode() === 'auto') applyTheme(); }; if (mqLight.addEventListener) mqLight.addEventListener('change', onMq); else if (mqLight.addListener) mqLight.addListener(onMq); }
  function openLook() {
    var m = themeMode(), opt = function (v, t, sub) { return '<button class="set-row radio' + (m === v ? ' on' : '') + '" data-theme="' + v + '"><span class="grow"><span class="t">' + t + '</span><span class="s">' + sub + '</span></span><span class="rd"></span></button>'; };
    cfgShow('look', cfgBar('Apariencia', 'settings') + '<div class="cfg-list">' + opt('dark', 'Oscuro', 'Fondo morado oscuro') + opt('light', 'Claro', 'Fondo claro') + opt('auto', 'Automático', 'Sigue el tema de tu celular') + '</div>');
  }

  /* ---------- eventos (delegación) ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button,[data-go],[data-dpick]'); if (!el) return;
    if (el.tagName === 'BUTTON') buzz();
    var g = function (a) { return el.getAttribute(a); };
    var k = g('data-key'), cmd = g('data-cmd'), go = g('data-go'), open = g('data-open'), act = g('data-act'), seg = g('data-seg');
    if (k) send({ t: 'key', k: k });
    else if (g('data-vol')) { var d = Number(g('data-vol')); send({ t: 'vol', d: d }); if (!S.fake) { var nv = Math.max(0, Math.min(100, (S.room.vol == null ? 30 : S.room.vol) + d)); S.room.vol = nv; S.room.muted = false; renderHeader(); toast('Volumen ' + nv); } }
    else if (g('data-app')) { send({ t: 'app', id: g('data-app') }); if (!S.fake) toast('Abriendo ' + APP_NAMES[g('data-app')] + ' en la TV'); }
    else if (g('data-dpick')) pickDec(g('data-dpick'));
    else if (g('data-dmain')) setMain(g('data-dmain'));
    else if (g('data-dren')) { S.decEdit = g('data-dren'); renderDecs(); }
    else if (g('data-rsave')) saveRename(g('data-rsave'));
    else if (g('data-dunl')) askUnlink(g('data-dunl'));
    else if (g('data-dlink')) doLink(g('data-dlink'), el);
    else if (g('data-fdel') !== null && el.hasAttribute('data-fdel')) favEdit(function (f) { f.splice(Number(g('data-fdel')), 1); });
    else if (g('data-fadd')) favEdit(function (f) { if (f.length < FAV_MAX) f.push(g('data-fadd')); else toast('Ya elegiste ' + FAV_MAX + ': quita una para agregar otra', true); });
    else if (g('data-pref')) { var pk = g('data-pref'); PREF[pk] = !PREF[pk]; ls.set('cp-prefs', JSON.stringify(PREF)); if (pk === 'vib' && PREF.vib) buzz(); openPrefs(); }
    else if (g('data-theme')) { ls.set('cp-theme', g('data-theme')); applyTheme(); openLook(); }
    else if (cmd) { send({ t: cmd }); if (cmd === 'menu' && !S.fake) toast(S.room && S.room.menu ? 'Cerrando el menú' : 'Menú abierto en la TV'); }
    else if (open) { send({ t: 'open', id: open, from: g('data-from') || '' }); toast('Abriendo en la TV…'); }
    else if (go) setTab(go);
    else if (seg) { S.seg = seg; if (S.sheet === 'match') reSheet(openMatchSheet); else if (S.sheet === 'mpre') reSheet(openPre); else renderAhora(); }
    else if (act === 'mAng') { S.mAng = Number(g('data-i')); reSheet(openGoal); }
    else if (act === 'mHeat') { S.mHeat = g('data-t'); reSheet(openHT); }
    else if (act === 'mPlay') { S.mPlay = Number(g('data-i')); reSheet(openHT); }
    else if (act === 'mVote') { S.mVote = Number(g('data-i')); send({ t: 'vote', who: C.MATCH.halftime.poll[S.mVote][0] }); toast('¡Gracias por votar!'); reSheet(openHT); }
    else if (act === 'mPromo') { toast(C.MATCH.halftime.sponsors[Number(g('data-i'))][1] + ' · promoción simulada'); }
    else if (act === 'power') { send({ t: 'power' }); if (!S.fake) toast(S.room && S.room.off ? 'Encendiendo la TV' : 'Apagando la TV'); }
    else if (act === 'mute') { send({ t: 'mute' }); if (!S.fake) { S.room.muted = !S.room.muted; renderHeader(); toast(S.room.muted ? 'TV en silencio' : 'Sonido activado'); } }
    else if (act === 'decoders') openDecoders();
    else if (act === 'decsBack') { if (S.noDec) toast('Vincula un decodificador para usar el control', true); else setTab('control'); }
    else if (act === 'renCancel') { S.decEdit = null; renderDecs(); }
    else if (act === 'decScan') scanDecs();
    else if (act === 'unlinkOk') doUnlink(g('data-id'));
    else if (act === 'setApps') openFavs();
    else if (act === 'setPrefs') openPrefs();
    else if (act === 'setLook') openLook();
    else if (act === 'settings') openSettings();
    else if (act === 'ahoraGo') { closeSheet(); setTab('ahora'); }
    else if (act === 'cfgClose') setTab('control');
    else if (act === 'mvToEnd') { closeSheet(); send({ t: 'toEnd' }); }
    else if (g('data-mvsong')) { var ms = g('data-mvsong').split(':'); saveSong(ms[1] === 's' ? sceneNow().song : mvSongs(ms[0])[Number(ms[1])]); }
    else if (g('data-mvrec')) toast('Agregada a tu lista: ' + g('data-mvrec'));
    else if (act === 'pause') { send({ t: 'pause' }); toast('Pausado: mira la TV'); }
    else if (act === 'play') send({ t: 'play' });
    else if (act === 'saveSong') saveSong(sceneNow().song);
    else if (act === 'product') openProduct(sceneNow().products[Number(g('data-i'))]);
    else if (act === 'saveBanner') { saveSong($('banner')._song); $('banner').hidden = true; }
    else if (act === 'closeBanner') $('banner').hidden = true;
    else if (act === 'offerGo') offerGo(g('data-ch') === 'match' ? 'match' : Number(g('data-ch')));
    else if (act === 'factNext' || act === 'factPrev') openFactsList(C.channel(Number(g('data-ch'))), Number(g('data-i')) + (act === 'factNext' ? 1 : -1));
    else if (act === 'recipe') { $('banner').hidden = true; S.rcTab = 'ing'; openRecipe(); }
    else if (g('data-rctab')) { S.rcTab = g('data-rctab'); openRecipe(); }
    else if (g('data-ing') !== null && el.hasAttribute('data-ing')) { var ii = Number(g('data-ing')); S.rcSel[ii] = !S.rcSel[ii]; var keepTop = $('sheet').scrollTop; openRecipe(); $('sheet').scrollTop = keepTop; }
    else if (g('data-store') !== null && el.hasAttribute('data-store')) { S.rcStore = Number(g('data-store')); var kt = $('sheet').scrollTop; openRecipe(); $('sheet').scrollTop = kt; }
    else if (act === 'rcBuy') {
      var rt = rcTotal(); if (!rt.n) return;
      openSheet('done', '<div style="text-align:center;padding:10px 0"><div style="font-size:54px">🛒</div><h2 style="margin-top:6px">¡Pedido en camino!</h2><p class="sub">' + rt.n + ' ingredientes de ' + esc(rt.st.n) + ' · ' + money(rt.t + C.RECIPE.ship) + ' · llegan en ' + esc(rt.st.eta) + '. Demo: no se hace ningún cargo.</p></div>' +
        '<button class="btn" data-act="closeSheet">Listo</button>');
      buzz(); setTimeout(buzz, 160);
      send({ t: 'notice', text: '🛒 ' + S.name + ' pidió los ingredientes en Shop · llegan en ' + rt.st.eta });
    }
    else if (act === 'factPlay') { closeSheet(); send({ t: 'play' }); }
    else if (g('data-qty')) { var dc = C.channel(Number(g('data-ch'))), qid = g('data-id'); S.cart[qid] = Math.max(0, Math.min(9, (S.cart[qid] || 0) + Number(g('data-qty')))); openDelivery(dc); }
    else if (g('data-bag') !== null && el.hasAttribute('data-bag')) { var bc = C.channel(Number(g('data-ch'))), bi = g('data-bag'); S.bag[bi] = !S.bag[bi]; openShop(bc); }
    else if (act === 'orderGo') {
      var oc2 = C.channel(Number(g('data-ch'))), tot = cartTotal(oc2.offer.menu, S.cart); if (!tot.n) return;
      doneSheet('🛵', '¡Pedido confirmado!', oc2.offer.place + ' · ' + tot.n + (tot.n === 1 ? ' producto' : ' productos') + ' · ' + money(tot.t + 29) + ' · llega en unos ' + oc2.offer.eta + ' min. Demo: no se hace ningún cargo.');
      send({ t: 'notice', text: '🍕 ' + S.name + ' pidió pizza · llega en unos ' + oc2.offer.eta + ' min' });
    }
    else if (act === 'buyGo') {
      var sc2 = C.channel(Number(g('data-ch'))), nb = 0, tb = 0; for (var bk in S.bag) if (S.bag.hasOwnProperty(bk) && S.bag[bk]) { nb++; tb += sc2.offer.products[bk].p; } if (!nb) return;
      doneSheet('🛍️', '¡Compra lista!', nb + (nb === 1 ? ' prenda' : ' prendas') + ' · ' + money(tb) + ' · llega en 2 a 3 días.');
      send({ t: 'notice', text: '🛍️ ' + S.name + ' compró el look de ' + sc2.offer.who + ' en Shop' });
    }
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
    /* fuera del Control queda a la mano un mini control (Regresar, reproducir/pausar, Inicio) para no tener que volver de pestaña */
    var mini = t === 'ahora';
    $('mini').hidden = !mini; document.body.classList.toggle('has-mini', mini);
    $('tabs').classList.toggle('empty', !mini);
    document.body.classList.toggle('in-decs', t === 'decs' || t === 'cfg');   /* en Decodificadores y Configuración no se muestra el encabezado del control */
    if (t === 'decs') { S.decEdit = null; renderDecs(); if (!S.decScanned) { S.decScanned = true; scanDecs(); } }   /* sin pestañas: la barra de abajo solo existe para el mini control */
    render(); window.scrollTo(0, 0);
  }

  /* Botón presionado visible en iOS (Safari no muestra :active sin esto) y en Android. */
  document.addEventListener('touchstart', function () {}, { passive: true });
  var pressedAt = 0;
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b || !PREF.touch) return;
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
    for (var i = 0; i < bs.length; i++) { var id = bs[i].getAttribute('data-app'), im = CP.logos.img(id, 'w92', 'logo'); if (im && !bs[i].querySelector('img')) { bs[i].insertAdjacentHTML('afterbegin', im); bs[i].className += ' has-logo'; } }
  }
  CP.logos.ready(paintAppLogos);
  applyTheme(); renderApps();

  connect(S.code);
})(window.CP);
