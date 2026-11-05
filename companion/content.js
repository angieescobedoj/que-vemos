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

  var SWIPE = { id: 'swipe', kind: 'game', title: '¿Qué vemos?', sub: 'Match de películas · 2 o más', tag: 'Juego' };

  /* Canales en vivo (ficticios). Se llega a ellos con el control de la TV (arriba/abajo) o por voz, nunca con una lista en el celular.
     El canal 7 transmite el partido, así que el contenido "En vivo" del inicio es ese canal. */
  var CHANNELS = [
    { n: 2, name: 'Noticias 2', show: 'Noticiero de la mañana', next: 'Clima y tráfico', art: ['#3D7BE8', '#0E1A3A'] },
    { n: 5, name: 'Kids 5', show: 'Las aventuras de Pipo', next: 'Caricaturas clásicas', art: ['#FFB547', '#C2582E'] },
    { n: 7, name: 'Deportes 7', show: 'Halcones vs. Toros', next: 'Resumen de la jornada', match: true, art: ['#2E7D49', '#123A22'] },
    { n: 9, name: 'Cine 9', show: 'Ciclo de cine de oro', next: 'Función de medianoche', art: ['#C792C9', '#3A2160'] },
    { n: 11, name: 'Cultura 11', show: 'Documental: ríos y montañas', next: 'Concierto en vivo', art: ['#7CC7A8', '#174536'] }
  ];
  function channel(n) { for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].n === n) return CHANNELS[i]; return null; }

  /* Apps de streaming instaladas en el decodificador. Abrirlas se simula (la API de Totalplay para lanzar apps está pendiente). */
  var APPS = [
    { id: 'netflix', kind: 'app', title: 'Netflix', sub: 'App', tag: 'App', color: '#E50914' },
    { id: 'prime', kind: 'app', title: 'Prime Video', sub: 'App', tag: 'App', color: '#1A98FF' },
    { id: 'youtube', kind: 'app', title: 'YouTube', sub: 'App', tag: 'App', color: '#FF0033' }
  ];
  var LIVE = { id: 'tv', kind: 'live', title: 'TV en vivo', sub: 'Canales 2 · 5 · 7 · 9 · 11', tag: 'Canales' };

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
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i];
    return null;
  }
  function all() { return [SERIES, MATCH, LIVE].concat(APPS).concat([GAME, SWIPE]); }

  CP.content = { MATCH: MATCH, SERIES: SERIES, GAME: GAME, SWIPE: SWIPE, CHANNELS: CHANNELS, channel: channel, APPS: APPS, LIVE: LIVE, sceneAt: sceneAt, fmt: fmt, byId: byId, all: all };
})(window.CP = window.CP || {});
