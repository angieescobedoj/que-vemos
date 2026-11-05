/* Companion · celular. Lee el estado de la TV (rooms/{code}) y le manda comandos (rooms/{code}/players/{pid}). */
(function (CP) {
  'use strict';
  var C = CP.content, store = CP.store;
  var POLL_MS = 900, HEARTBEAT_MS = 15000, COLORS = ['#7A4CC4', '#E58AC3', '#2F6FE0', '#2F9E62', '#E0A93A'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  var params = new URLSearchParams(location.search);
  var S = { code: (params.get('sala') || '').toUpperCase(), pid: null, name: '', room: null, tab: 'control', cmds: [], lastSeq: 0,
            writing: false, dirty: false, songSeen: null, seg: 'lineup', peeked: {}, offline: false, myIndex: 0, padDir: 0 };

  /* ---------- envío de comandos (cola de los últimos 10, escrituras en serie) ---------- */
  function nextSeq() { var t = Date.now(); S.lastSeq = t > S.lastSeq ? t : S.lastSeq + 1; return S.lastSeq; }
  function send(cmd) {
    cmd.seq = nextSeq();
    S.cmds.push(cmd); if (S.cmds.length > 10) S.cmds = S.cmds.slice(-10);
    flush();
  }
  function flush() {
    if (S.writing) { S.dirty = true; return; }
    S.writing = true; S.dirty = false;
    store.updatePlayer(S.code, S.pid, { cmds: S.cmds, seen: Date.now() }, function (err) {
      S.writing = false;
      setOffline(!!err);
      if (S.dirty) flush();
    });
  }
  function setOffline(off) { S.offline = off; $('dot').className = 'dot' + (off ? ' off' : ''); }
  function toast(t) {
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* ignore */ } }

  /* ---------- vincular ---------- */
  function showJoin() {
    $('join').hidden = false; $('main').hidden = true; $('tabs').hidden = true;
    $('jCode').textContent = S.code || '—';
    $('jCodeIn').hidden = !!S.code;
    $('jName').value = ls.get('cp-name') || '';
  }
  $('jGo').onclick = function () { connect($('jName').value.trim() || 'Invitado'); };
  function connect(name) {
    if (!S.code) S.code = $('jCodeIn').value.trim().toUpperCase();
    if (S.code.length !== 4) { $('jErr').hidden = false; $('jErr').textContent = 'Escribe el código de 4 letras que aparece en la TV.'; return; }
    $('jGo').textContent = 'Vinculando…';
    store.getRoom(S.code, function (err, room) {
      $('jGo').textContent = 'Vincular con la TV';
      if (err) { $('jErr').hidden = false; $('jErr').textContent = 'No pudimos conectar. Revisa tu internet e intenta de nuevo.'; return; }
      if (!room || room.kind !== 'companion') { $('jErr').hidden = false; $('jErr').textContent = 'No encontramos esa sala. Revisa el código en la TV.'; S.code = params.get('sala') ? S.code : ''; return; }
      S.name = name; ls.set('cp-name', name);
      /* En modo demo cada pestaña es un "celular" distinto: el id vive en sessionStorage para no compartirse. */
      var idStore = CP.DEMO ? { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } } } : ls;
      S.pid = idStore.get('cp-pid-' + S.code) || ('p' + Math.random().toString(36).slice(2, 10));
      idStore.set('cp-pid-' + S.code, S.pid);
      store.updatePlayer(S.code, S.pid, { name: name, joinedAt: Date.now(), seen: Date.now(), kind: 'companion', cmds: S.cmds }, function (err2) {
        if (err2) { $('jErr').hidden = false; $('jErr').textContent = 'No pudimos vincularte. Intenta de nuevo.'; return; }
        S.room = room; S.songSeen = room.songSeq || 0;
        $('join').hidden = true; $('main').hidden = false; $('tabs').hidden = false;
        $('hSub').textContent = name + ' · sala ' + S.code;
        render(); startPolling();
        setInterval(function () { store.updatePlayer(S.code, S.pid, { seen: Date.now() }, function (e) { setOffline(!!e); }); }, HEARTBEAT_MS);
      });
    });
  }

  /* ---------- polling del estado de la TV ---------- */
  function startPolling() {
    (function loop() {
      store.getRoom(S.code, function (err, room) {
        setOffline(!!err);
        if (!err && room) { S.room = room; render(); }
        setTimeout(loop, POLL_MS);
      });
    })();
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
    renderNow(); renderGame();
    if (S.tab === 'ahora') renderAhora();
    if (S.tab === 'seguir') renderSeguir();
    /* A4 · aviso de "Está sonando" */
    if (S.songSeen === null) S.songSeen = r.songSeq || 0;
    if ((r.songSeq || 0) > S.songSeen) { S.songSeen = r.songSeq; if (r.content === 'series') showSongBanner(sceneNow().song); }
  }
  function renderNow() {
    var r = S.room, el = $('now'), html = '';
    if (r.screen === 'player' && r.content === 'series') {
      var sc = sceneNow();
      html = '<span class="thumb" style="background:linear-gradient(150deg,' + sc.art[0] + ',' + sc.art[1] + ')"></span><div><div class="k">' + (r.playing ? 'Reproduciendo' : 'En pausa') + '</div><div class="t">Marea Alta · T1 E3</div><div class="s">' + C.fmt(pos()) + ' / ' + C.fmt(C.SERIES.duration) + '</div></div>';
    } else if (r.screen === 'player' && r.content === 'match') {
      html = '<span class="thumb" style="background:repeating-linear-gradient(90deg,#2E7D49 0 12%,#2A7243 12% 24%)"></span><div><div class="k">En vivo · min ' + matchMinute() + '</div><div class="t">' + C.MATCH.home.name + ' ' + C.MATCH.score[0] + ' – ' + C.MATCH.score[1] + ' ' + C.MATCH.away.name + '</div><div class="s">' + C.MATCH.sub + '</div></div>';
    } else if (r.screen === 'search') {
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">En la TV</div><div class="t">Buscando “' + esc(r.query) + '”</div><div class="s">Usa las flechas y OK para elegir</div></div>';
    } else if (r.screen === 'swipe') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#F38BC9,#5470D6)"></span><div><div class="k">En la TV</div><div class="t">¿Qué vemos? · match de películas</div><div class="s">Muévete con el control · Regresar o Inicio vuelve a Sala TV</div></div>';
    } else if (r.screen === 'game') {
      html = '<span class="thumb" style="background:linear-gradient(150deg,#3A2A6E,#120C22)"></span><div><div class="k">En la TV</div><div class="t">Atrapa estrellas</div></div>';
    } else {
      html = '<span class="thumb" style="background:var(--card-2)"></span><div><div class="k">En la TV</div><div class="t">' + (r.dialog === 'resume' ? '¿Continuar Marea Alta?' : 'Inicio') + '</div><div class="s">Navega con el control o elige abajo</div></div>';
    }
    el.innerHTML = html;
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
    $('sheet').hidden = false; $('scrim').hidden = false;
    send({ t: 'product', what: prod[0] });
  }

  /* ---------- eventos (delegación) ---------- */
  var qTimer = null;
  $('q').addEventListener('input', function () {
    var v = this.value; clearTimeout(qTimer);
    qTimer = setTimeout(function () { send({ t: 'search', q: v }); }, 350);
  });
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { this.blur(); send({ t: 'key', k: 'DOWN' }); } });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('button,[data-go]'); if (!el) return;
    var k = el.getAttribute('data-key'), cmd = el.getAttribute('data-cmd'), go = el.getAttribute('data-go'), open = el.getAttribute('data-open'), act = el.getAttribute('data-act'), seg = el.getAttribute('data-seg');
    if (k) { send({ t: 'key', k: k }); buzz(); }
    else if (cmd) { send({ t: cmd }); buzz(); }
    else if (open) { send({ t: 'open', id: open, from: el.getAttribute('data-from') || '' }); buzz(); toast('Abriendo en la TV…'); }
    else if (go) { setTab(go); }
    else if (seg) { S.seg = seg; renderAhora(); }
    else if (act === 'pause') { send({ t: 'pause' }); toast('Pausado: mira la TV'); }
    else if (act === 'play') send({ t: 'play' });
    else if (act === 'saveSong') saveSong(sceneNow().song);
    else if (act === 'product') openProduct(sceneNow().products[Number(el.getAttribute('data-i'))]);
    else if (act === 'saveBanner') { saveSong($('banner')._song); $('banner').hidden = true; }
    else if (act === 'closeBanner') $('banner').hidden = true;
    else if (act === 'closeSheet') { $('sheet').hidden = true; $('scrim').hidden = true; }
    else if (act === 'exitGame') {
      if (S.padDir) setDir(0);
      $('sheet').innerHTML = '<h2 style="margin-bottom:6px">¿Salir del juego?</h2><p style="color:#555;margin-bottom:18px">La partida termina para todos y la TV regresa al inicio.</p><div class="stack"><button class="btn" data-act="confirmExit">Salir del juego</button><button class="btn ghost" style="background:#EFE8F7;color:#7A4CC4" data-act="closeSheet">Seguir jugando</button></div>';
      $('sheet').hidden = false; $('scrim').hidden = false;
    }
    else if (act === 'confirmExit') { send({ t: 'home' }); $('sheet').hidden = true; $('scrim').hidden = true; toast('Saliendo del juego…'); }
  });
  $('scrim').onclick = function () { $('sheet').hidden = true; $('scrim').hidden = true; };

  function setTab(t) {
    S.tab = t;
    var panes = document.querySelectorAll('[data-tab]'); for (var i = 0; i < panes.length; i++) panes[i].hidden = panes[i].getAttribute('data-tab') !== t;
    var tabs = document.querySelectorAll('.tab'); for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j].getAttribute('data-go') === t);
    render(); window.scrollTo(0, 0);
  }

  /* Si este celular ya estaba vinculado a esta sala (p. ej. regresa del juego de películas), reconecta solo. */
  (function autoResume() {
    var name = ls.get('cp-name'), pid = CP.DEMO ? (function () { try { return sessionStorage.getItem('cp-pid-' + S.code); } catch (e) { return null; } })() : ls.get('cp-pid-' + S.code);
    if (S.code && name && pid) { showJoin(); $('join').hidden = true; connect(name); }
    else showJoin();
  })();
})(window.CP);
