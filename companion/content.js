/* Companion · contenido simulado (compartido por TV y celular). ES5.
   Todo es ficticio: equipos, series, actores, canciones y productos son inventados para la demo. */
(function (CP) {
  'use strict';

  var MATCH = {
    id: 'match', kind: 'live', title: 'Halcones vs. Toros', sub: 'Deportes 7 · Liga de la Ciudad', tag: 'En vivo',
    home: { name: 'Halcones', short: 'HAL', color: '#2F6FE0' },
    away: { name: 'Toros', short: 'TOR', color: '#D9364F' },
    score: [1, 0], startMinute: 12,
    lineups: {
      home: [['1', 'R. Medina', 'POR'], ['4', 'J. Castañeda', 'DEF'], ['5', 'L. Ocampo', 'DEF'], ['3', 'M. Treviño', 'DEF'], ['2', 'A. Robles', 'DEF'],
             ['8', 'D. Ibarra', 'MED'], ['6', 'C. Pineda', 'MED'], ['10', 'E. Salcedo', 'MED'], ['7', 'F. Quiroga', 'DEL'], ['9', 'H. Villalobos', 'DEL'], ['11', 'G. Montaño', 'DEL']],
      away: [['12', 'S. Bermúdez', 'POR'], ['3', 'O. Lozano', 'DEF'], ['4', 'P. Arriaga', 'DEF'], ['5', 'T. Zamora', 'DEF'], ['2', 'V. Cervantes', 'DEF'],
             ['8', 'N. Esparza', 'MED'], ['6', 'B. Galindo', 'MED'], ['10', 'K. Rosales', 'MED'], ['7', 'I. Solís', 'DEL'], ['9', 'U. Delgado', 'DEL'], ['11', 'Y. Navarro', 'DEL']]
    },
    stats: [['Posesión', 56, 44, '%'], ['Tiros', 7, 3, ''], ['Tiros a gol', 3, 1, ''], ['Faltas', 6, 9, '']],
    facts: ['Halcones no pierde en casa desde hace 8 partidos.', 'E. Salcedo lleva 6 goles en la temporada.', 'Es el clásico número 41 entre ambos equipos.']
  };

  var SERIES = {
    id: 'series', kind: 'vod', title: 'Marea Alta', sub: 'Temporada 1 · Episodio 3 · La isla', tag: 'Serie',
    duration: 2880, saved: 1395,
    scenes: [
      { from: 0, to: 960, place: 'El muelle al amanecer',
        cast: [['Lucía Ferrer', 'Sofía Lara'], ['Mateo Ríos', 'Diego Anaya']],
        song: { t: 'Luces de neón', a: 'Banda Aurora' },
        products: [['Chamarra de mezclilla', '$1,299'], ['Lentes de sol redondos', '$649']],
        art: ['#F2B5A0', '#7A3A5A', '#1E1020'] },
      { from: 960, to: 1920, place: 'El faro abandonado',
        cast: [['Lucía Ferrer', 'Sofía Lara'], ['Inés Valdés', 'Carmen Ruiz']],
        song: { t: 'Marea', a: 'Valentina Sol' },
        products: [['Bolsa de piel', '$1,890'], ['Reloj plateado', '$2,450']],
        art: ['#9FC3E8', '#2C4A7A', '#0E1626'] },
      { from: 1920, to: 2880, place: 'La fiesta en la playa',
        cast: [['Mateo Ríos', 'Diego Anaya'], ['Inés Valdés', 'Carmen Ruiz'], ['El capitán', 'Ramón Félix']],
        song: { t: 'Fuego lento', a: 'Los Atardeceres' },
        products: [['Camisa de lino', '$899'], ['Sandalias de piel', '$1,150']],
        art: ['#F5C76B', '#B5683A', '#2A120A'] }
    ]
  };

  var GAME = { id: 'game', kind: 'game', title: 'Atrapa estrellas', sub: 'Juego · 1 a 4 jugadores con tu celular', tag: 'Juego', seconds: 45 };

  var SHIP = { id: 'ship', kind: 'game', title: 'Nave espacial', sub: 'Juego · tu celular se vuelve control clásico', tag: 'Juego', seconds: 60 };

  /* Corto real con licencia abierta: Big Buck Bunny © Blender Foundation | bigbuckbunny.org · CC BY 3.0.
     Se usa un fragmento de 60 s con un corte a comerciales; durante el corte el celular muestra datos curiosos. */
  var BUNNY = { id: 'bunny', kind: 'video', title: 'Big Buck Bunny', sub: 'Corto animado · 2008', tag: 'Seguir viendo', src: 'video/big-buck-bunny.mp4?v=1',
    poster: 'video/bbb-poster.jpg', dur: 60, adAt: 38, adSecs: 20, credit: '© Blender Foundation · bigbuckbunny.org · CC BY 3.0',
    facts: [
      'Lo hizo en 2008 el Blender Institute, en Ámsterdam, como proyecto de la Blender Foundation.',
      'Se creó completo con software libre: el programa de animación es Blender.',
      'Su nombre clave durante la producción fue «Proyecto Peach».',
      'Tiene licencia Creative Commons: cualquiera puede usarlo y compartirlo, como en esta demo.',
      'Los tres roedores que molestan al conejo se llaman Frank, Rinky y Gimera.'
    ] };

  var SWIPE = { id: 'swipe', kind: 'game', title: '¿Qué vemos?', sub: 'Match de películas · 2 o más', tag: 'Juego' };

  /* Canales en vivo (ficticios). Se llega a ellos con el control de la TV (arriba/abajo) o por voz, nunca con una lista en el celular.
     El canal 7 transmite el partido, así que el contenido "En vivo" del inicio es ese canal. */
  var CHANNELS = [
    { n: 2, name: 'Noticias 2', show: 'Noticiero de la mañana', next: 'Clima y tráfico', art: ['#3D7BE8', '#0E1A3A'],
      offer: { kind: 'anytime', title: 'Noticiero de la mañana', min: 60, line: 'Míralo completo desde el inicio' } },
    { n: 5, name: 'Kids 5', show: 'Shrek', tmdb: 808, next: 'Caricaturas clásicas', art: ['#FFB547', '#C2582E'],
      offer: { kind: 'rent', tmdb: 809, title: 'Shrek 2', price: 39 } },
    { n: 7, name: 'Deportes 7', show: 'Halcones vs. Toros', next: 'Resumen de la jornada', match: true, art: ['#2E7D49', '#123A22'],
      offer: { kind: 'anytime', title: 'Halcones vs. Toros', min: 110, line: 'La repetición completa del partido' } },
    { n: 9, name: 'Cine 9', show: 'Beetlejuice', tmdb: 4011, next: 'Función de medianoche', art: ['#C792C9', '#3A2160'],
      offer: { kind: 'rent', tmdb: 917496, title: 'Beetlejuice Beetlejuice', price: 59 } },
    { n: 11, name: 'Clásicos 11', show: 'Volver al futuro', tmdb: 105, next: 'Concierto en vivo', art: ['#7CC7A8', '#174536'],
      offer: { kind: 'rent', tmdb: 165, title: 'Volver al futuro II', price: 39 } }
  ];
  function channel(n) { for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].n === n) return CHANNELS[i]; return null; }

  /* Apps de streaming instaladas en el decodificador. Abrirlas se simula (la API de Totalplay para lanzar apps está pendiente). */
  var APPS = [
    { id: 'netflix', kind: 'app', title: 'Netflix', sub: 'App', tag: 'App', color: '#E50914' },
    { id: 'prime', kind: 'app', title: 'Prime Video', sub: 'App', tag: 'App', color: '#1A98FF' },
    { id: 'youtube', kind: 'app', title: 'YouTube', sub: 'App', tag: 'App', color: '#FF0033' }
  ];
  var LIVE = { id: 'tv', kind: 'live', title: 'TV en vivo', sub: 'Canales 2 · 5 · 7 · 9 · 11', tag: 'Canales' };

  /* Catálogo simulado de películas para "Noche de películas" (mismo enfoque que el modo demo del juego ¿Qué vemos?):
     títulos inventados, portadas en degradado, cada una disponible en una de las apps del decodificador. */
  var GENRE_IDS = [35, 28, 18, 27, 10749, 878, 16, 53, 12, 10751, 99, 80];
  var GENRE_NAMES = { 35: 'Comedia', 28: 'Acción', 18: 'Drama', 27: 'Terror', 10749: 'Romance', 878: 'Ciencia ficción', 16: 'Animación', 53: 'Suspenso', 12: 'Aventura', 10751: 'Familia', 99: 'Documental', 80: 'Crimen' };
  var MOVIES = (function () {
    var T = ['La última función', 'El silencio del lago', 'Noches en Coyoacán', 'Lo que queda de octubre', 'El club de los martes', 'Sombras sobre Marte',
      'Un verano en Valparaíso', 'La casa de los espejos', 'Regreso a la montaña', 'Cartas para Elena', 'El secreto de Lucía', 'Fuego en la niebla',
      'Tres bodas y un perro', 'Código Tormenta', 'La herencia del faro', 'Pasillo 9', 'Amor a destiempo', 'Órbita cero',
      'Pequeño dragón azul', 'Doble filo', 'Expedición Amazonas', 'Mi familia en apuros', 'Planeta océano', 'El robo del siglo',
      'Vecinos de terror', 'La carrera final', 'Mientras dormías', 'Café para dos', 'Línea de fuego', 'El jardín de Nora',
      'Ciudad sin luz', 'La isla de los gatos', 'Profundo', 'Cuarenta y ocho horas', 'Tierra de gigantes', 'El último tren'];
    var apps = ['netflix', 'prime', 'youtube'], seed = 11, out = [];
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 36; i++) {
      var h = Math.floor(rnd() * 360);
      out.push({ id: 'm' + i, title: T[i], year: 2008 + Math.floor(rnd() * 18),
        genres: [GENRE_IDS[i % 12], GENRE_IDS[(i * 5 + 3) % 12]], min: 88 + Math.floor(rnd() * 50), score: Math.round((6.2 + rnd() * 2.4) * 10) / 10,
        app: apps[(i + Math.floor(i / 12)) % 3], art: ['hsl(' + h + ',48%,48%)', 'hsl(' + ((h + 50) % 360) + ',45%,14%)', 'hsla(' + ((h + 180) % 360) + ',70%,75%,.45)'] });
    }
    return out;
  })();
  /* Las 6 que mejor coinciden con los géneros elegidos (con un poco de azar para que no salgan siempre las mismas) */
  function recommend(genres, n) {
    var list = MOVIES.slice(), g = genres || [];
    for (var i = 0; i < list.length; i++) {
      var hit = 0; for (var j = 0; j < g.length; j++) if (list[i].genres[0] === g[j] || list[i].genres[1] === g[j]) hit++;
      list[i]._rank = hit * 10 + list[i].score + Math.random() * 2.5;
    }
    list.sort(function (a, b) { return b._rank - a._rank; });
    return list.slice(0, n || 6);
  }
  function movieById(id) { for (var i = 0; i < MOVIES.length; i++) if (MOVIES[i].id === id) return MOVIES[i]; return null; }

  function sceneAt(pos) {
    var s = SERIES.scenes;
    for (var i = 0; i < s.length; i++) if (pos >= s[i].from && pos < s[i].to) return i;
    return s.length - 1;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function byId(id) {
    if (id === 'match') return MATCH; if (id === 'series') return SERIES; if (id === 'game') return GAME; if (id === 'swipe') return SWIPE;
    if (id === 'tv') return LIVE;
    if (id === 'bunny') return BUNNY;
    if (id === 'ship') return SHIP;
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i];
    return null;
  }
  function all() { return [SERIES, BUNNY, MATCH, LIVE].concat(APPS).concat([GAME, SHIP, SWIPE]); }

  CP.content = { MATCH: MATCH, SERIES: SERIES, GAME: GAME, SWIPE: SWIPE, SHIP: SHIP, BUNNY: BUNNY, MOVIES: MOVIES, recommend: recommend, movieById: movieById, GENRE_NAMES: GENRE_NAMES, CHANNELS: CHANNELS, channel: channel, APPS: APPS, LIVE: LIVE, sceneAt: sceneAt, fmt: fmt, byId: byId, all: all };
})(window.CP = window.CP || {});
