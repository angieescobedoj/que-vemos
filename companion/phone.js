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
    $('decState').textContent = S.offline && !S.fake ? 'Sin conexión' : (STATE_TXT[st] + (S.fake ? ' · simulado' : '') + (!S.fake && S.room.sleepLeft && st === 'on' ? ' · 🌙 se apaga en ' + S.room.sleepLeft + ' min' : ''));
    $('dot').className = 'dot' + (st === 'off' ? ' off' : st === 'sleep' ? ' sleep' : '');
    $('pwr').className = 'pwr' + (st === 'sleep' ? ' sleep' : '');
    var vol = S.fake ? S.fake.vol : (S.room.vol == null ? 30 : S.room.vol), muted = S.fake ? S.fake.muted : S.room.muted;
    $('volLbl').textContent = muted ? 'Silencio' : 'Vol ' + vol;
    $('muteBtn').className = muted ? 'on' : '';
    $('playBtn').className = !S.fake && S.room.playing ? 'playing' : '';
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
      var sc = sceneNow(); loadSin();
      html = '<span class="thumb" style="' + sinArt(sc.art) + '"></span><div><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + ' · ' + esc(sc.place) + '</div><div class="t">Los Pecadores</div><div class="s">' + C.fmt(pos()) + ' / ' + C.fmt(C.SERIES.duration) + '</div></div>';
    } else if (r.screen === 'player' && r.content === 'recipe') {
      var RC = C.RECIPE, si = r.recipeStep || 0;
      html = '<span class="thumb" style="background:#3E7A3A url(' + C.PHOTOS.recipe + '200) center/cover"></span><div class="grow"><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + ' · paso ' + (si + 1) + ' de ' + RC.steps.length + '</div><div class="t">' + esc(RC.dish) + '</div><div class="s">' + esc(RC.steps[si].t) + '</div></div>' +
        (r.recipeSeq ? '<button class="nowbtn" data-act="recipe">🛒 Receta</button>' : '');
    } else if (r.screen === 'player' && r.content === 'video') {
      var vp = r.playing ? r.pos + Math.max(0, (Date.now() - r.posAt) / 1000) : r.pos;
      html = '<span class="thumb" style="background:#000 url(' + C.BUNNY.poster + ') center/cover"></span><div><div class="k">' + (r.ad ? 'Comercial · vuelve en ' + Math.max(0, Math.ceil((r.ad.endsAt - Date.now()) / 1000)) + ' s' : (r.playing ? 'Reproduciendo' : 'En pausa')) + '</div><div class="t">Big Buck Bunny</div><div class="s">' + C.fmt(Math.min(vp, C.BUNNY.dur)) + ' / ' + C.fmt(C.BUNNY.dur) + ' · ⏪ ⏯ ⏩ para controlar</div></div>';
    } else if (r.screen === 'rent') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#7A4CC4,#2A1E60)"></span><div><div class="k">En la TV · On Demand</div><div class="t">Confirma la renta</div><div class="s">Pulsa OK para rentar y ver</div></div>';
    } else if (r.screen === 'ship') {
      html = '<span class="thumb" style="background:linear-gradient(180deg,#070512,#2A1E60)"></span><div><div class="k">En la TV</div><div class="t">Nave espacial</div><div class="s">Tu celular es el control</div></div>';
    } else if (r.screen === 'player' && r.content === 'movie' && r.movie) {
      var mv = r.movie, mp = r.playing ? r.pos + Math.max(0, (Date.now() - r.posAt) / 1000) : r.pos;
      html = '<span class="thumb" style="background:linear-gradient(170deg,' + mv.art[0] + ',' + mv.art[1] + ')"></span><div><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + ' · ' + esc(mv.label || APP_NAMES[mv.app] || '') + '</div><div class="t">' + esc(mv.t) + '</div><div class="s">' + C.fmt(mp) + ' / ' + C.fmt(mv.dur) + ' · ⏪ ⏯ ⏩ para controlar</div></div>';
    } else if (r.screen === 'player' && r.content === 'match') {
      html = '<span class="thumb" style="background:#2E7D49 url(' + C.PHOTOS.match + '200) center/cover"></span><div><div class="k">En vivo · min ' + matchMinute() + '</div><div class="t">' + C.MATCH.home.name + ' ' + C.MATCH.score[0] + ' – ' + C.MATCH.score[1] + ' ' + C.MATCH.away.name + '</div><div class="s">▲▼ cambian de canal · OK abre la guía</div></div>';
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
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">En la TV' + (r.exp ? ' · ✨ ' + esc(r.exp) : '') + '</div><div class="t">' + (r.menu ? 'Menú abierto' : r.dialog === 'resume' ? '¿Continuar Los Pecadores?' : 'Inicio') + '</div><div class="s">Navega con las flechas y OK</div></div>';
    }
    el.innerHTML = html;
  }
  function appColor(id) { for (var i = 0; i < C.APPS.length; i++) if (C.APPS[i].id === id) return C.APPS[i].color; return '#7A4CC4'; }

  /* ---------- decodificador simulado: responde con feedback, sin TV detrás ---------- */
  function fakeCommand(cmd) {
    var f = S.fake, n = f.name;
    if (cmd.t === 'say' || cmd.t === 'peek') return;
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
    renderHeader(); renderNow(); renderGame(); renderPad2();
    /* si el tiempo de apagado se eligió en la TV, la hoja del celular se cierra sola */
    if (S.sheet === 'sleep' && S.sleepAsk) {
      if (r.dialog === 'sleep') S.sleepAsk.seen = true;
      else if (S.sleepAsk.seen) { S.sleepAsk = null; closeSheet(); toast(r.sleepLeft ? '🌙 Elegido en la TV: se apaga en ' + r.sleepLeft + ' min' : 'Elegido en la TV: sin apagado'); }
    }
    if (S.tab === 'ahora') renderAhora();
    if (S.tab === 'seguir') renderSeguir();
    /* A4 · aviso de "Está sonando" */
    if (S.songSeen === null) S.songSeen = r.songSeq || 0;
    if ((r.songSeq || 0) > S.songSeen) { S.songSeen = r.songSeq; if (r.content === 'series') showSongBanner(sceneNow().song); }
    /* corte a comerciales: datos curiosos de la película mientras dura */
    if (r.ad && r.ad.seq !== S.adSeen) { S.adSeen = r.ad.seq; showFacts(r.ad); }
    /* receta: llega sola a los pocos segundos de empezar el video (la TV no se pausa) */
    if (S.recipeSeen === undefined) S.recipeSeen = r.recipeSeq || 0;
    if (r.recipeSeq && r.recipeSeq !== S.recipeSeen) { S.recipeSeen = r.recipeSeq; showRecipeBanner(); }
    if (S.sheet === 'recipe' && S.rcTab === 'pasos' && S.rcStepShown !== (r.recipeStep || 0)) openRecipe();
    if (!r.ad && S.sheet === 'facts' && !S.factsEnding) endFacts();
    /* pausa en un canal: sugerencia (On Demand renta o Anytime) */
    if (S.offerSeen === undefined) S.offerSeen = r.offer ? r.offer.seq : 0;
    if (r.offer && r.offer.seq !== S.offerSeen) { S.offerSeen = r.offer.seq; showOffer(r.offer); }
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
      html += '<p class="eyebrow">En esta escena · ' + esc(sc.place) + '</p><h2 style="margin-top:4px">Los Pecadores</h2>';
      html += '<div style="margin-top:12px">' + (r.playing
        ? '<button class="btn" data-act="pause">❚❚  Pausar y descubrir en la TV</button>'
        : '<button class="btn ghost" data-act="play">▶  Seguir viendo</button>') + '</div>';
      html += '<div class="sec"><p class="sec-h">Personajes</p><div class="card">';
      for (var c = 0; c < sc.cast.length; c++) html += '<div class="item"><span class="av">' + esc(sc.cast[c][0].charAt(0)) + '</span><div class="grow"><div class="t">' + esc(sc.cast[c][0]) + '</div><div class="s">Interpretado por ' + esc(sc.cast[c][1]) + '</div></div></div>';
      html += '</div></div>';
      html += '<div class="sec"><p class="sec-h">Está sonando</p><div class="card"><div class="item"><span class="av">♪</span><div class="grow"><div class="t">' + esc(sc.song.t) + '</div><div class="s">' + esc(sc.song.a) + ' · de la película</div></div></div><div class="songbtns"><a class="btn sm" href="' + listenUrl(sc.song) + '" target="_blank" rel="noopener">▶ Escuchar</a><button class="btn sm ghost" data-act="saveSong">Guardar</button></div></div></div>';
      html += '<div class="sec"><p class="sec-h">Productos de la escena</p><div class="card">';
      for (var p = 0; p < sc.products.length; p++) html += '<div class="item"><span class="av">🛍</span><div class="grow"><div class="t">' + esc(sc.products[p][0]) + '</div><div class="s">' + esc(sc.products[p][1]) + '</div></div><button class="btn sm ghost" data-act="product" data-i="' + p + '">Ver</button></div>';
      html += '</div></div>';
      html += soundtrackHtml();
      el.innerHTML = html; return;
    }
    html += '<div class="empty"><p class="eyebrow">Ahora en la TV</p><h2 style="margin-top:6px">Elige algo para ver</h2><p class="muted">Aquí verás información de lo que se está reproduciendo: personajes, canciones, productos o la alineación del partido.</p><div class="stack">' +
      '<button class="btn" data-open="match">Ver el partido en vivo</button><button class="btn ghost" data-open="series" data-from="">Ver Los Pecadores</button><button class="btn ghost" data-cmd="game">Jugar Atrapa estrellas</button></div></div>';
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
    loadSin();
    var onTv = r.screen === 'player' && r.content === 'series', p = onTv ? pos() : (r.saved || sv.saved);
    var html = '<p class="eyebrow">Seguir viendo</p><div class="series-card" style="margin-top:8px"><div class="art" style="' + sinArt(a, true) + '"><span>Los Pecadores</span></div><div class="body">' +
      '<div style="font-weight:700">Película · 2025</div><div class="muted" style="font-size:13px">Ryan Coogler · 2 h 17 min</div>' +
      '<div class="prog"><i style="width:' + (p / sv.duration * 100) + '%"></i></div><div class="muted" style="font-size:12px;margin-bottom:14px">' +
      (onTv ? 'Reproduciéndose en la TV · ' + C.fmt(p) : 'Te quedaste en ' + C.fmt(p) + ' · quedan ' + C.fmt(sv.duration - p)) + '</div>' +
      (onTv ? '<button class="btn ghost" data-go="ahora">Ver qué hay en esta escena</button>'
            : '<div class="stack"><button class="btn" data-open="series" data-from="resume">Continuar en la TV</button><button class="btn ghost" data-open="series" data-from="start">Desde el inicio</button></div>') +
      '</div></div>';
    var bOn = r.screen === 'player' && r.content === 'video', bs = r.vsaved || 0;
    html += '<div class="series-card" style="margin-top:14px"><div class="art" style="background:#000 url(' + C.BUNNY.poster + ') center/cover"><span>Big Buck Bunny</span></div><div class="body">' +
      '<div style="font-weight:700">Corto animado · 2008</div><div class="muted" style="font-size:13px">' + esc(C.BUNNY.credit) + '</div>' +
      '<div class="prog"><i style="width:' + ((bOn ? pos() : bs) / C.BUNNY.dur * 100) + '%"></i></div><div class="muted" style="font-size:12px;margin-bottom:14px">' + (bOn ? 'Reproduciéndose en la TV' : bs > 1 ? 'Te quedaste en ' + C.fmt(bs) : 'Fragmento de 1 minuto con corte a comerciales') + '</div>' +
      (bOn ? '' : '<div class="stack"><button class="btn" data-open="bunny">' + (bs > 1 ? 'Continuar en la TV' : 'Ver en la TV') + '</button></div>') + '</div></div>';
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
  function showSongBanner(song) {
    var b = $('banner'); b.className = 'banner';
    b.innerHTML = '<span class="ic">♪</span><div><div class="k">Está sonando en Los Pecadores</div><div class="t">' + esc(song.t) + '</div><div class="s">' + esc(song.a) + '</div></div><div class="x"><a class="lk" href="' + listenUrl(song) + '" target="_blank" rel="noopener">▶ Escuchar</a><button data-act="saveBanner">Guardar</button><button class="g" data-act="closeBanner">Cerrar</button></div>';
    b.hidden = false; b._song = song; buzz();
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { b.hidden = true; }, 9000);
  }
  function openProduct(prod) {
    $('sheet').innerHTML = '<div class="img"></div><p class="eyebrow" style="color:#7A4CC4">De la escena · Los Pecadores</p><h2 style="margin:4px 0 2px">' + esc(prod[0]) + '</h2><p style="color:#555;margin-bottom:16px">' + esc(prod[1]) + ' · Demo: compra no disponible en el prototipo</p><button class="btn" data-act="closeSheet">Listo</button>';
    $('sheet').hidden = false; $('scrim').hidden = false; S.sheet = 'product';
    send({ t: 'product', what: prod[0] });
  }

  /* ---------- datos curiosos durante el comercial ---------- */
  var factsTimer = null;
  function showFacts(ad) {
    var facts = C.BUNNY.facts, i = 0;
    S.factsEnding = false;
    openSheet('facts', '<p class="eyebrow" style="color:#7A4CC4">Mientras ves el comercial</p><h2>Datos curiosos de Big Buck Bunny</h2><p class="sub" id="fLeft"></p>' +
      '<div class="fact" id="fact"></div><div class="dots" id="fDots"></div>');
    function paint() {
      if (S.sheet !== 'facts') return;
      $('fact').innerHTML = '<span class="fn">' + (i + 1) + '/' + facts.length + '</span>' + esc(facts[i]);
      var d = ''; for (var k = 0; k < facts.length; k++) d += '<i class="' + (k === i ? 'on' : '') + '"></i>'; $('fDots').innerHTML = d;
      buzz();
    }
    function left() { var l = Math.max(0, Math.ceil((ad.endsAt - Date.now()) / 1000)); if ($('fLeft')) $('fLeft').textContent = 'La película vuelve en ' + l + ' s'; }
    paint(); left();
    clearInterval(factsTimer);
    var per = Math.max(3000, Math.floor((ad.secs || 20) * 1000 / facts.length)), last = Date.now();
    factsTimer = setInterval(function () {
      if (S.sheet !== 'facts') { clearInterval(factsTimer); return; }
      left();
      if (Date.now() - last >= per && i < facts.length - 1) { last = Date.now(); i++; paint(); }
    }, 500);
  }
  function endFacts() {
    S.factsEnding = true; clearInterval(factsTimer);
    if ($('fLeft')) $('fLeft').textContent = '¡Ya volvió la película! Mira la TV';
    setTimeout(function () { if (S.sheet === 'facts') closeSheet(); S.factsEnding = false; }, 2200);
  }

  /* ---------- sugerencia al pausar un canal ---------- */
  var KEY = 'a7795e812c110c40515e414ceb379fac';
  function money(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tmdbPoster(id, cb) {
    QV.http.get('https://api.themoviedb.org/3/movie/' + id + '?api_key=' + KEY + '&language=es-MX', function (err, d) { if (!err && d) cb(d); });
  }
  /* Al pausar en la TV llega una sugerencia distinta según lo que se está viendo */
  function showOffer(o) {
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
    $('sheet').className = 'sheet' + (name === 'voice' ? ' voice' : '');
    $('sheet').innerHTML = (name === 'voice' ? '' : '<button class="x" data-act="closeSheet" aria-label="Cerrar">✕</button>') + html;
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
      '<div class="chips"><button data-q="Pecadores">Pecadores</button><button data-q="Netflix">Netflix</button><button data-q="Partido">Partido</button><button data-q="Canal">Canales</button><button data-q="Estrellas">Estrellas</button></div>' +
      '<button class="btn" data-act="closeSheet">Listo, elegir con el control</button>');
    var q = $('sq'); q.value = S.room && S.room.screen === 'search' ? (S.room.query || '') : '';
    setTimeout(function () { try { q.focus(); } catch (e) { /* ignore */ } }, 60);
    q.addEventListener('input', function () { var v = q.value; clearTimeout(qTimer); qTimer = setTimeout(function () { send({ t: 'search', q: v }); }, 300); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { q.blur(); closeSheet(); send({ t: 'key', k: 'DOWN' }); } });
    send({ t: 'search', q: q.value });
  }

  /* ---------- control por voz (reconocimiento de voz del navegador) ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, listening = false;
  /* Onda: barras en forma de píldora que se mueven mientras escucha (CSS) y respiran en reposo. */
  function voiceWave() {
    var H = [14, 24, 40, 60, 84, 108, 84, 60, 40, 24, 14], html = '<div class="vwave" id="vWave" aria-hidden="true"><span class="vline"></span>';
    for (var i = 0; i < H.length; i++) html += '<span class="vbar" style="height:' + H[i] + 'px;animation-delay:' + (Math.abs(i - 5) * 0.09).toFixed(2) + 's"></span>';
    return html + '<span class="vline"></span></div>';
  }
  var V_ICONS = {
    app: '<path d="M3.5 5.5h17v11h-17zM9 20h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 8.5v5l4-2.5z" fill="currentColor"/>',
    vol: '<path d="M3.5 9.2h3.8L12 5.4v13.2l-4.7-3.8H3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15.5 9.5a3.6 3.6 0 0 1 0 5M18.3 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    tv: '<path d="M3 5.5h18v11.5H3zM8 20.5h8M12 17v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  };
  var V_SUGG = [['app', 'Abre Netflix'], ['vol', 'Sube el volumen'], ['tv', 'Cambia al canal 5'], ['search', 'Busca una película']];
  var vAwait = null; /* 'search' = lo siguiente que digas es el título a buscar */
  function openVoice() {
    var sg = '';
    for (var i = 0; i < V_SUGG.length; i++) sg += '<button class="vsug" data-say="' + V_SUGG[i][1] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + V_ICONS[V_SUGG[i][0]] + '</svg><span>“' + V_SUGG[i][1] + '”</span></button>';
    vAwait = null;
    openSheet('voice', '<div class="vhead"><button data-act="closeSheet" aria-label="Regresar"><svg viewBox="0 0 24 24"><path d="M14.5 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<h2>Control por voz</h2><button data-act="closeSheet" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>' +
      voiceWave() +
      '<p class="vtext" id="vText">' + (SR ? 'Te escucho…' : 'Escribe lo que dirías') + '</p><p class="vreply" id="vReply"></p>' +
      '<div class="vsugs">' + sg + '</div>' +
      '<div class="vfoot"><button class="vmic" id="micBtn" data-act="listen" aria-label="Hablar"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' +
      '<form class="vform" id="vForm"' + (SR ? ' hidden' : '') + '><input class="in-l" id="vIn" placeholder="Escríbelo aquí" autocomplete="off"><button>Enviar</button></form>' +
      '<button class="vtype" data-act="vtype"' + (SR ? '' : ' hidden') + '>Escribir en lugar de hablar</button></div>');
    $('vForm').onsubmit = function (e) { e.preventDefault(); var v = $('vIn').value.trim(); if (v) { $('vIn').value = ''; runVoice(v); } };
    if (SR) listen(); else setListening(false);
  }
  /* Estado visual: la onda se mueve y el micrófono brilla solo mientras escucha. */
  function setListening(on) {
    if ($('micBtn')) $('micBtn').className = 'vmic' + (on ? ' on' : '');
    if ($('vWave')) $('vWave').className = 'vwave' + (on ? ' on' : '');
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
      rec.onend = function () { listening = false; setListening(false); if ($('vText') && $('vText').textContent === 'Te escucho…') $('vText').textContent = 'Toca para hablar'; };
      rec.start(); listening = true; setListening(true); $('vText').textContent = 'Te escucho…'; $('vReply').textContent = '';
    } catch (e) { listening = false; $('vReply').textContent = 'No se pudo usar el micrófono. Escríbelo abajo.'; }
  }
  function stopListening() { if (rec && listening) { try { rec.stop(); } catch (e) { /* ignore */ } } listening = false; setListening(false); }

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
      return { reply: 'No hay canal ' + n + '. Prueba con el 2, 5, 7 o 9.' };
    }
    if (/(siguiente canal|canal siguiente|sube (de |el )?canal)/.test(t)) return { cmds: [{ t: 'chstep', d: 1 }], reply: 'Siguiente canal' };
    if (/(canal anterior|baja (de |el )?canal)/.test(t)) return { cmds: [{ t: 'chstep', d: -1 }], reply: 'Canal anterior' };
    if (/(tv en vivo|television en vivo|canales)/.test(t)) return { cmds: [{ t: 'open', id: 'tv' }], reply: 'Abriendo TV en vivo' };
    if (/netflix/.test(t)) return { cmds: [{ t: 'app', id: 'netflix' }], reply: 'Abriendo Netflix' };
    if (/(prime|amazon)/.test(t)) return { cmds: [{ t: 'app', id: 'prime' }], reply: 'Abriendo Prime Video' };
    if (/(youtube|you tube)/.test(t)) return { cmds: [{ t: 'app', id: 'youtube' }], reply: 'Abriendo YouTube' };
    if (/^(busca|buscar|buscame|encuentra|quiero ver) (una |algo |alguna )?(pelicula|peli|serie|algo)( para ver)?$/.test(t)) return { cmds: [{ t: 'search', q: '' }], reply: 'Abrí la búsqueda en la TV. ¿Cuál quieres ver? Dime el título.', await: 'search' };
    if ((m = /^(busca|buscar|buscame|encuentra) (.+)$/.exec(t))) return { cmds: [{ t: 'search', q: m[2] }], reply: 'Buscando «' + m[2] + '»' };
    if (/(partido|futbol|halcones|toros|deportes)/.test(t)) return { cmds: [{ t: 'open', id: 'match' }], reply: 'Poniendo el partido en vivo' };
    if (/(pecadores|sinners|seguir viendo)/.test(t)) return { cmds: [{ t: 'open', id: 'series', from: 'resume' }], reply: 'Continuando Los Pecadores' };
    if (/(que vemos|match de peliculas)/.test(t)) return { cmds: [{ t: 'open', id: 'swipe' }], reply: 'Abriendo ¿Qué vemos?' };
    if (/(receta|enchiladas|cocina)/.test(t)) return { cmds: [{ t: 'open', id: 'recipe' }], reply: 'Poniendo la receta de enchiladas verdes' };
    if (/(nave|espacial)/.test(t)) return { cmds: [{ t: 'open', id: 'ship' }], reply: 'Abriendo Nave espacial' };
    if (/(big buck|bunny|conejo)/.test(t)) return { cmds: [{ t: 'open', id: 'bunny' }], reply: 'Poniendo Big Buck Bunny' };
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
    /* Después de «Busca una película», lo que digas es el título (salvo que sea otro comando). */
    var r = parseVoice(text), reply;
    if (vAwait === 'search' && (!r || (r.cmds && r.cmds[0].t === 'search' && !r.cmds[0].q))) r = { cmds: [{ t: 'search', q: text }], reply: 'Buscando «' + text + '» en la TV' };
    vAwait = r && r.await ? r.await : null;
    if (r && r.exp) { var e = expById(r.exp); if (e) { applyExp(e, true); reply = r.exp === 'none' ? 'Experiencia quitada' : 'Activando ' + e.name; } }
    else if (r && r.cmds) { reply = r.reply; send({ t: 'say', text: text, reply: reply }); for (var i = 0; i < r.cmds.length; i++) send(r.cmds[i]); }
    else if (r) reply = r.reply;
    if (!reply) { reply = 'No entendí «' + text + '». Prueba «abre YouTube» o «canal 5».'; buzz(); }
    else buzz();
    if (r && r.exp) send({ t: 'say', text: text, reply: reply });
    if ($('vText')) $('vText').textContent = '«' + text + '»';
    if ($('vReply')) $('vReply').textContent = reply;
    if (r && r.sheet === 'find') openFind(true);
    if (r && r.exp === 'night') setTimeout(openSleepSheet, 1200);
    if (vAwait === 'search' && SR) setTimeout(function () { if (S.sheet === 'voice' && !listening) listen(); }, 1400);
  }

  /* ---------- experiencias: ajustes de la TV en un toque (volumen, brillo, pantalla) ---------- */
  var PRESETS = [
    { id: 'movies', ic: '🍿', name: 'Noche de películas', vol: 60, bright: 65, desc: 'Películas recomendadas con tus gustos · luz baja' },
    { id: 'night', ic: '🌙', name: 'Modo noche', vol: 20, bright: 35, sleep: -1, desc: 'Volumen y brillo bajos · tú eliges en cuánto se apaga' },
    { id: 'gaming', ic: '🎮', name: 'Modo gaming', vol: 70, bright: 100, desc: 'Te lleva a los juegos · volumen alto' },
    { id: 'listen', ic: '🎧', name: 'Solo escuchar', vol: 45, bright: 100, audio: true, desc: 'Apaga la pantalla y sigue sonando la música' }
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

  /* Modo noche: ¿en cuánto se apaga? Se puede elegir aquí o en la TV con el control (lo que pase primero). */
  function openSleepSheet() {
    var html = '<h2>🌙 Modo noche</h2><p class="sub">¿En cuánto se apaga la TV? También puedes elegirlo en la TV con el control.</p><div class="chips">';
    var opts = [15, 30, 45, 60, 90, 0];
    for (var i = 0; i < opts.length; i++) html += '<button data-sleep="' + opts[i] + '">' + (opts[i] ? opts[i] + ' min' : 'No apagar') + '</button>';
    html += '</div><label class="lf">O escribe cuántos minutos</label><div class="stepper"><button data-sstep="-5" aria-label="Menos">−</button>' +
      '<input id="slIn" type="number" inputmode="numeric" min="1" max="300" value="25"><span>min</span><button data-sstep="5" aria-label="Más">＋</button></div>' +
      '<button class="btn" data-act="sleepGo" style="margin-top:12px">Programar apagado</button>';
    openSheet('sleep', html);
    S.sleepAsk = { seen: false };
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
    else if (g('data-exp')) { var ex = expById(g('data-exp')); if (ex && ex.id === 'movies') openTastes(); else if (ex && ex.id === 'night') { applyExp(ex); openSleepSheet(); } else if (ex) applyExp(ex); }
    else if (g('data-sstep')) { var si = $('slIn'); si.value = Math.max(1, Math.min(300, (Number(si.value) || 0) + Number(g('data-sstep')))); }
    else if (act === 'sleepGo') { var sv = Math.round(Number($('slIn').value)); if (!(sv >= 1 && sv <= 300)) { toast('Escribe entre 1 y 300 minutos', true); return; } send({ t: 'sleep', min: sv }); S.sleepAsk = null; closeSheet(); toast('🌙 La TV se apagará en ' + sv + ' min'); }
    else if (g('data-sleep') !== null && el.hasAttribute('data-sleep')) { var mn = Number(g('data-sleep')); send({ t: 'sleep', min: mn }); S.sleepAsk = null; closeSheet(); toast(mn ? '🌙 La TV se apagará en ' + mn + ' min' : 'Sin apagado automático'); }
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
    else if (act === 'vtype') { $('vForm').hidden = false; el.hidden = true; stopListening(); setTimeout(function () { try { $('vIn').focus(); } catch (e2) { /* ignore */ } }, 50); }
    else if (act === 'listen') listen();
    else if (act === 'exps') openExps();
    else if (act === 'newExp') openNewExp();
    else if (act === 'saveExp') saveExp();
    else if (act === 'find') openFind();
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
    for (var i = 0; i < bs.length; i++) { var id = bs[i].getAttribute('data-app'), im = CP.logos.img(id, 'w92', 'logo'); if (im && !bs[i].querySelector('img')) { bs[i].insertAdjacentHTML('afterbegin', im); bs[i].className += ' has-logo'; } }
  }
  CP.logos.ready(paintAppLogos);

  connect(S.code);
})(window.CP);
