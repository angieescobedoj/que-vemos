/* Companion · momentos del contenido (v7.26). Compartido por TV y celular. ES5.
   Regla: mostrar información cuando la atención en la TV baja y no competir con la pantalla en el momento fuerte.
   Fases: antes (preparar) · durante (acompañar sin distraer) · después (profundizar).
   Partido, equipos, patrocinador y precios son ficticios. Los datos de Los Pecadores son públicos y sin spoilers
   (salvo la explicación del final, que se muestra solo si el usuario la abre). */
(function (CP) {
  'use strict';
  var C = CP.content;

  /* ======================= ⚽ PARTIDO =======================
     Línea de tiempo comprimida (segundos desde que se abre el canal): previa 20 s · 1 minuto de juego = 3 s · medio tiempo 30 s */
  var T = { pre: 20, spm: 3, half: 30 };
  T.ht = T.pre + 45 * T.spm;      /* 155: medio tiempo */
  T.h2 = T.ht + T.half;           /* 185: segundo tiempo */
  T.end = T.h2 + 45 * T.spm;      /* 320: final */
  function atMinute(m) { return m <= 45 ? T.pre + m * T.spm : T.h2 + (m - 45) * T.spm; }

  /* kind: goal / card → jugada clave (detalle 10–30 s después) · sub / var → pausa natural (detalle de inmediato) */
  var EV = [
    { m: 18, k: 'goal', team: 'home', who: 'E. Salcedo', num: '10', note: 'Su 7.º gol del torneo · es el líder de goleo', angle: 'Cámara detrás de la portería', assist: 'Asistencia de D. Ibarra' },
    { m: 29, k: 'card', team: 'away', who: 'B. Galindo', num: '6', color: 'amarilla', note: 'Falta táctica para cortar un contragolpe de D. Ibarra' },
    { m: 35, k: 'sub', team: 'away', out: ['7', 'I. Solís', '35 min · 1 tiro · 71% de pases'], inn: ['17', 'R. Fuentes', 'Delantero · 21 años · 3 goles en la temporada'], why: 'Lesión en el tobillo' },
    { m: 41, k: 'var', team: 'home', who: 'F. Quiroga', note: 'Revisan un posible penal sobre F. Quiroga', result: 'Sin penal: el contacto fue fuera del área' },
    { m: 58, k: 'goal', team: 'away', who: 'U. Delgado', num: '9', note: 'Su 4.º gol del torneo · el primero de cabeza', angle: 'Cámara aérea', assist: 'Centro de K. Rosales' },
    { m: 66, k: 'sub', team: 'home', out: ['11', 'G. Montaño', '66 min · 2 tiros · 1 pase clave'], inn: ['19', 'A. Peralta', 'Extremo · 5 asistencias en la temporada'], why: 'Cambio táctico' },
    { m: 77, k: 'goal', team: 'home', who: 'H. Villalobos', num: '9', note: 'Su 3.º gol en los últimos 3 partidos', angle: 'Cámara lateral', assist: 'Asistencia de A. Peralta' },
    { m: 84, k: 'card', team: 'away', who: 'P. Arriaga', num: '4', color: 'roja', note: 'Segunda amarilla: Toros se queda con 10' }
  ];
  for (var i = 0; i < EV.length; i++) { EV[i].id = i; EV[i].at = atMinute(EV[i].m); }
  function detailWin(ev) { return ev.k === 'sub' || ev.k === 'var' ? [1, 21] : [10, 30]; }

  function matchAt(startMs, nowMs) {
    var e = startMs ? Math.max(0, (nowMs - startMs) / 1000) : 0, ph, min;
    if (e < T.pre) { ph = 'pre'; min = 0; }
    else if (e < T.ht) { ph = 'live'; min = Math.floor((e - T.pre) / T.spm); }
    else if (e < T.h2) { ph = 'half'; min = 45; }
    else if (e < T.end) { ph = 'live'; min = 45 + Math.floor((e - T.h2) / T.spm); }
    else { ph = 'final'; min = 90; }
    var sc = [0, 0], past = [], mo = null;
    for (var j = 0; j < EV.length; j++) if (e >= EV[j].at) { past.push(EV[j]); if (EV[j].k === 'goal') sc[EV[j].team === 'home' ? 0 : 1]++; }
    if (ph === 'live') for (var k = past.length - 1; k >= 0; k--) { var d = e - past[k].at, w = detailWin(past[k]); if (d >= w[0] && d < w[1]) { mo = past[k]; break; } }
    var cd = ph === 'pre' ? T.pre - e : ph === 'half' ? T.h2 - e : 0;
    return { e: e, phase: ph, minute: min, score: sc, events: past, moment: mo, countdown: Math.max(0, Math.ceil(cd)), firstHalf: e < T.ht };
  }
  /* saltos de la simulación (segundos desde el inicio) */
  function firstOf(k) { for (var j = 0; j < EV.length; j++) if (EV[j].k === k) return EV[j]; return EV[0]; }
  var JUMP = { pre: 0, live: T.pre + 0.5, goal: firstOf('goal').at - 2, card: firstOf('card').at - 2, sub: firstOf('sub').at - 1, 'var': firstOf('var').at - 1, half: T.ht + 0.5, final: T.end + 0.5 };

  var FINAL_STATS = [['Posesión', 55, 45, '%'], ['Tiros', 14, 9, ''], ['Tiros a gol', 6, 3, ''], ['Tiros de esquina', 7, 4, ''], ['Faltas', 11, 15, ''], ['Pases completados', 412, 338, '']];
  function statsAt(min) {
    var f = Math.max(0.05, Math.min(1, min / 90)), out = [];
    for (var j = 0; j < FINAL_STATS.length; j++) { var s = FINAL_STATS[j]; out.push(s[3] === '%' ? s.slice() : [s[0], Math.round(s[1] * f), Math.round(s[2] * f), s[3]]); }
    return out;
  }
  var TABLE = [['Águilas', 28], ['Halcones', 25], ['Pumas del Sur', 24], ['Linces', 23], ['Toros', 22], ['Jaguares', 20]];
  /* tabla "si terminara así": suma los puntos del marcador actual */
  function tableAt(sc, live) {
    var rows = [];
    for (var j = 0; j < TABLE.length; j++) {
      var n = TABLE[j][0], p = TABLE[j][1];
      if (live && n === 'Halcones') p += sc[0] > sc[1] ? 3 : sc[0] === sc[1] ? 1 : 0;
      if (live && n === 'Toros') p += sc[1] > sc[0] ? 3 : sc[0] === sc[1] ? 1 : 0;
      rows.push([n, p, j + 1]);
    }
    rows.sort(function (a, b) { return b[1] - a[1] || a[2] - b[2]; });
    return rows;
  }
  /* mapa de calor 10×6 (determinístico): Halcones carga por la derecha, Toros por el centro */
  function heat(team) {
    var g = [];
    for (var y = 0; y < 6; y++) for (var x = 0; x < 10; x++) {
      var v = team === 'home' ? Math.exp(-((x - 6.5) * (x - 6.5) / 9 + (y - 1.3) * (y - 1.3) / 3)) + 0.55 * Math.exp(-((x - 4) * (x - 4) / 6 + (y - 3) * (y - 3) / 5))
                              : Math.exp(-((x - 3.5) * (x - 3.5) / 7 + (y - 2.7) * (y - 2.7) / 2.5)) + 0.4 * Math.exp(-((x - 6) * (x - 6) / 5 + (y - 4.5) * (y - 4.5) / 3));
      g.push(Math.min(1, v));
    }
    return g;
  }
  var MATCHX = {
    T: T, EV: EV, JUMP: JUMP, matchAt: matchAt, statsAt: statsAt, tableAt: tableAt, heat: heat,
    h2h: ['Toros 1–2 Halcones · abr 2026', 'Halcones 0–0 Toros · nov 2025', 'Halcones 3–1 Toros · may 2025', 'Toros 2–1 Halcones · ene 2025', 'Halcones 1–1 Toros · ago 2024'],
    h2hSum: [2, 2, 1],
    injured: [['Halcones', 'M. Ríos', 'Rodilla · regresa en 2 semanas'], ['Toros', 'J. Paredes', 'Muslo · fuera de la convocatoria']],
    quiniela: [54, 24, 22],
    saves: [{ m: 12, t: 'Atajada de S. Bermúdez', d: 'Le quita el gol a H. Villalobos en el mano a mano' }],
    pollHalf: { q: '¿Quién fue el mejor del primer tiempo?', o: ['E. Salcedo', 'S. Bermúdez', 'D. Ibarra'], base: [48, 31, 21] },
    sponsor: { n: 'Bebidas Cumbre', t: '2x1 en tu pedido de medio tiempo', s: 'Llega antes del segundo tiempo con Shop Totalplay · marca ficticia' },
    ratings: [['H. Villalobos', 'HAL', 8.6], ['E. Salcedo', 'HAL', 8.3], ['U. Delgado', 'TOR', 7.8], ['S. Bermúdez', 'TOR', 7.5], ['D. Ibarra', 'HAL', 7.4], ['A. Peralta', 'HAL', 7.2]],
    mvp: { o: ['H. Villalobos', 'E. Salcedo', 'U. Delgado'], base: [46, 38, 16] },
    next: { t: 'Linces vs. Halcones', s: 'Sábado 28 de noviembre · 19:00 · Canal 7' }
  };

  /* ======================= 🎬 PELÍCULA (Los Pecadores) =======================
     Fases por posición: antes (primeros 45 s) · durante (trivia opcional en escenas tranquilas) · créditos (últimos 3 min).
     Durante, cada ciclo de 4 min tiene una escena tranquila (0–40 s) y una escena intensa (150–190 s) en la que no se muestra nada. */
  var MOVIE = {
    info: [['Año', '2025'], ['Duración', '2 h 17 min'], ['Género', 'Terror · Drama · Música'], ['Dirección', 'Ryan Coogler'], ['Música', 'Ludwig Göransson'], ['Clasificación', 'B15']],
    cast: [['Michael B. Jordan', 'Smoke y Stack'], ['Hailee Steinfeld', 'Mary'], ['Miles Caton', 'Sammie'], ["Jack O'Connell", 'Remmick'], ['Wunmi Mosaku', 'Annie'], ['Delroy Lindo', 'Delta Slim']],
    know: ['Sucede en el Mississippi de 1932, a lo largo de un día y una noche.', 'Michael B. Jordan interpreta a los dos gemelos: Smoke y Stack.', 'La música blues es parte de la historia: pon atención a las canciones.', 'Mezcla drama de época, música y terror.'],
    trivia: [
      { t: 'Créditos de apertura', f: 'Se filmó con cámaras IMAX de 65 mm y en Ultra Panavision 70.' },
      { t: 'Cambio de locación', f: 'Es el debut en el cine de Miles Caton, que canta sus propias canciones.' },
      { t: 'Escena sin diálogo', f: 'La música original es de Ludwig Göransson, colaborador de Coogler desde «Fruitvale Station».' },
      { t: 'Transición', f: 'Coogler se inspiró en su tío James, gran fan del blues del Mississippi.' }
    ],
    cycle: 240, calm: [0, 40], intense: [150, 190], before: 45, credits: 180,
    endNote: 'El final regresa a la idea de que la música une a la comunidad y del precio de ser libres. Quédate: hay escenas durante y después de los créditos.',
    behind: ['Se estrenó en cines en abril de 2025.', 'Hay una secuencia musical que mezcla épocas, del blues al hip hop.', 'Fue la quinta película de Coogler y la cuarta con Michael B. Jordan.'],
    recs: [['Nosferatu', '2024 · Terror'], ['Huye (Get Out)', '2017 · Terror · Suspenso'], ['Pantera Negra', '2018 · Acción · también de Coogler']]
  };
  function movieAt(pos, dur) {
    if (pos < MOVIE.before) return { phase: 'before' };
    if (pos >= dur - MOVIE.credits) return { phase: 'credits' };
    var c = pos % MOVIE.cycle, idx = Math.floor(pos / MOVIE.cycle) % MOVIE.trivia.length;
    if (c >= MOVIE.calm[0] && c < MOVIE.calm[1]) return { phase: 'calm', trivia: MOVIE.trivia[idx], idx: idx, left: Math.ceil(MOVIE.calm[1] - c) };
    if (c >= MOVIE.intense[0] && c < MOVIE.intense[1]) return { phase: 'intense', left: Math.ceil(MOVIE.intense[1] - c) };
    return { phase: 'watch' };
  }
  MOVIE.JUMP = { before: 2, calm: MOVIE.cycle * 3 + 1, intense: MOVIE.cycle * 3 + MOVIE.intense[0] + 1, credits: C.SERIES.duration - MOVIE.credits + 5 };

  /* Big Buck Bunny: el corte comercial (ya existente) suma encuesta y ficha del personaje; al final, créditos. */
  var BUNNYX = {
    poll: { q: '¿Qué crees que haga Big Buck?', o: ['Se venga de los roedores', 'Los ignora y sigue jugando', 'Se hace su amigo'], base: [51, 27, 22] },
    character: ['Big Buck', 'Conejo gigante y tranquilo que vive en el bosque. Le encantan las mariposas… hasta que tres roedores empiezan a molestarlo.'],
    creditsAt: 54,
    recs: [['Sintel', '2010 · Blender Foundation'], ['Elephants Dream', '2006 · Blender Foundation'], ['Spring', '2019 · Blender Studio']]
  };

  /* ======================= 🍳 RECETA =======================
     Pasos sincronizados (6 × 25 s). Los pasos con "wait" son momentos de espera: temporizador, tips, nutrición y variaciones. */
  var RECIPEX = {
    meta: [['4', 'porciones'], ['25 min', 'tiempo'], ['Fácil', 'dificultad']],
    steps: [
      { q: '1 kg de tomate verde y 4 chiles serranos', s: 'Sin serranos: usa 2 jalapeños sin semillas (pica menos).', tool: ['Olla mediana de acero', '$389'],
        wait: { min: 10, t: 'Que hiervan 10 minutos' }, tip: 'Retíralos cuando pasen de verde brillante a verde olivo.' },
      { q: '¼ de cebolla, 1 diente de ajo, ½ manojo de cilantro y ½ taza del agua de cocción', s: 'Sin cilantro: usa perejil.', tool: ['Licuadora de 10 velocidades', '$1,299'] },
      { q: '1 cucharada de aceite y 1 cucharadita de sal', s: 'Sin aceite vegetal: usa manteca o aceite de oliva.', tool: ['Cacerola antiadherente', '$549'],
        wait: { min: 5, t: 'Deja que se sazone 5 minutos' }, tip: 'Tápala a medias: la salsa salpica cuando hierve.' },
      { q: '12 tortillas y ½ taza de aceite', s: 'Más ligeras: caliéntalas en el comal, sin aceite.', tool: ['Pinzas de cocina', '$129'] },
      { q: '300 g de queso fresco desmoronado', s: 'Sin queso fresco: usa panela o pollo deshebrado.', tool: ['Refractario de vidrio', '$299'] },
      { q: '½ taza de crema, ½ cebolla en aros y cilantro al gusto', s: 'Sin crema: usa yogur natural sin azúcar.', tool: ['Platos de cerámica (4)', '$459'] }
    ],
    nutrition: [['420', 'kcal'], ['18 g', 'proteína'], ['16 g', 'grasa'], ['48 g', 'carbohidratos']],
    variations: ['Suizas: agrega queso gratinado encima.', 'Con pollo: rellénalas con pollo deshebrado.', 'Enmoladas: cambia la salsa verde por mole.'],
    pairing: [['Agua de jamaica', 'fresca y ácida, equilibra el picante'], ['Cerveza clara', 'tipo lager, bien fría'], ['Vino blanco joven', 'Sauvignon Blanc']],
    related: [['Chilaquiles verdes', '15 min'], ['Enfrijoladas', '20 min'], ['Pozole verde', '1 h 30 min']],
    finalFrom: 125
  };
  function recipeAt(pos) {
    var si = C.recipeStep(pos), st = RECIPEX.steps[si];
    return { phase: pos >= RECIPEX.finalFrom ? 'final' : st.wait ? 'wait' : 'step', step: si };
  }
  RECIPEX.JUMP = { start: 0.5, step: 3 * 25 + 1, wait: 2 * 25 + 1, final: RECIPEX.finalFrom + 1 };

  CP.moments = { match: MATCHX, movie: MOVIE, movieAt: movieAt, bunny: BUNNYX, recipe: RECIPEX, recipeAt: recipeAt };
})(window.CP = window.CP || {});
