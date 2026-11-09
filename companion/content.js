/* Companion · contenido simulado (compartido por TV y celular). ES5.
   Todo es ficticio: equipos, series, actores, canciones y productos son inventados para la demo. */
(function (CP) {
  'use strict';

  var MATCH = {
    id: 'match', kind: 'live', title: 'Halcones vs. Toros', sub: 'Liga de la Ciudad · Jornada 12', tag: 'En vivo',
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

  /* Película real para "Seguir viendo": Los Pecadores (Sinners, 2025). Las imágenes salen del catálogo de TMDB en tiempo real.
     Elenco, lugares y canciones son los de la película; los productos son genéricos (sin marcas). */
  var SERIES = {
    id: 'series', kind: 'vod', title: 'Los Pecadores', sub: 'Película · 2025 · Ryan Coogler', tag: 'Película',
    tmdbQuery: 'Sinners', tmdbYear: 2025,
    duration: 8220, saved: 3900,
    scenes: [
      { from: 0, to: 2740, place: 'Clarksdale, Mississippi · 1932',
        cast: [['Smoke y Stack', 'Michael B. Jordan'], ['Pearline', 'Jayme Lawson']],
        song: { t: 'Pale, Pale Moon', a: 'Jayme Lawson' },
        products: [['Sombrero fedora de fieltro', '$899'], ['Traje de tres piezas', '$3,450']],
        art: ['#B07A4A', '#4A2A1A', '#140A06'] },
      { from: 2740, to: 5480, place: 'El juke joint, noche de apertura',
        cast: [['Sammie', 'Miles Caton'], ['Delta Slim', 'Delroy Lindo'], ['Annie', 'Wunmi Mosaku']],
        song: { t: 'I Lied to You', a: 'Miles Caton' },
        products: [['Guitarra acústica de acero', '$4,290'], ['Armónica en Do', '$399']],
        art: ['#C9873A', '#5A2A12', '#1A0A06'] },
      { from: 5480, to: 8220, place: 'Los visitantes de la noche',
        cast: [['Remmick', "Jack O'Connell"], ['Mary', 'Hailee Steinfeld'], ['Smoke y Stack', 'Michael B. Jordan']],
        song: { t: 'Rocky Road to Dublin', a: "Jack O'Connell y elenco" },
        products: [['Chamarra de cuero café', '$2,199'], ['Botas de trabajo', '$1,599']],
        art: ['#5A6A8A', '#1A2238', '#06080E'] }
    ]
  };


  var GAME = { id: 'game', kind: 'game', title: 'Atrapa estrellas', sub: 'Juego · 1 a 4 jugadores con tu celular', tag: 'Juego', seconds: 45 };

  var SHIP = { id: 'ship', kind: 'game', title: 'Nave espacial', sub: 'Juego · tu celular se vuelve control clásico', tag: 'Juego', seconds: 60 };

  /* Corto real con licencia abierta: Big Buck Bunny © Blender Foundation | bigbuckbunny.org · CC BY 3.0.
     Se usa un fragmento de 60 s con un corte a comerciales; durante el corte el celular muestra datos curiosos. */
  /* Recetas (no es canal: es un contenido de "Para ti"). La TV reproduce la receta paso a paso y al celular le llega
     la lista de ingredientes para comprarlos en un supermercado de Shop Totalplay sin pausar la TV. Supermercados ficticios. */
  var RECIPE = { id: 'recipe', kind: 'recipe', title: 'Enchiladas verdes', sub: 'Cocina en casa · 25 min', tag: 'Recetas', dur: 150, sendAt: 4,
    steps: [
      { t: 'Cuece los tomates y el chile', d: 'Hierve el tomate verde y los chiles serranos unos 10 minutos.', ic: '🍅' },
      { t: 'Licúa la salsa', d: 'Licúa con cebolla, ajo, cilantro y un poco del agua de cocción.', ic: '🥣' },
      { t: 'Sazona la salsa', d: 'Fríela 5 minutos en una cacerola con un poco de aceite y sal.', ic: '🍲' },
      { t: 'Calienta las tortillas', d: 'Pásalas por aceite caliente para que no se rompan al enrollar.', ic: '🔥' },
      { t: 'Rellena y enrolla', d: 'Rellena con queso fresco desmoronado y báñalas con la salsa.', ic: '🧀' },
      { t: 'Sirve', d: 'Decora con crema, cebolla en aros y cilantro. ¡Buen provecho!', ic: '🍽️' }
    ],
    ingredients: [
      { n: 'Tortillas de maíz', q: '1 kg', p: 28, ic: '🌽' },
      { n: 'Tomate verde', q: '1 kg', p: 32, ic: '🍅' },
      { n: 'Chile serrano', q: '250 g', p: 14, ic: '🌶️' },
      { n: 'Cebolla blanca', q: '2 piezas', p: 16, ic: '🧅' },
      { n: 'Ajo', q: '1 cabeza', p: 10, ic: '🧄' },
      { n: 'Cilantro', q: '1 manojo', p: 9, ic: '🌿' },
      { n: 'Queso fresco', q: '400 g', p: 68, ic: '🧀' },
      { n: 'Crema', q: '250 ml', p: 32, ic: '🥛' }
    ],
    stores: [
      { id: 'valle', n: 'Súper Del Valle', eta: '45 min', f: 1 },
      { id: 'express', n: 'Mercado Express', eta: '30 min', f: 1.08 },
      { id: 'ahorro', n: 'Súper Ahorro', eta: '1 h 30 min', f: 0.92 }
    ], ship: 29 };
  function recipeStep(pos) { return Math.max(0, Math.min(RECIPE.steps.length - 1, Math.floor(pos / (RECIPE.dur / RECIPE.steps.length)))); }

  var BUNNY = { id: 'bunny', kind: 'video', title: 'Big Buck Bunny', sub: 'Corto animado · 2008', tag: 'Seguir viendo', src: 'video/big-buck-bunny.mp4?v=1',
    poster: 'video/bbb-poster.jpg', dur: 60, adAt: 20, adSecs: 20, credit: '© Blender Foundation · bigbuckbunny.org · CC BY 3.0',
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
    { n: 2, name: 'Cine 2', show: 'Beetlejuice', tmdb: 4011, next: 'Función de medianoche', art: ['#C792C9', '#3A2160'],
      offer: { kind: 'rent', tmdb: 917496, title: 'Beetlejuice Beetlejuice', price: 59 } },
    { n: 5, name: 'Familia 5', show: 'Mi pobre angelito', tmdb: 771, next: 'Caricaturas clásicas', art: ['#E5484D', '#4A1420'],
      offer: { kind: 'delivery', place: 'Pizzería Rayo', eta: 35,
        menu: [
          { id: 'queso', n: 'Pizza de queso', d: 'Grande · como la de Kevin', p: 199, ic: '🍕' },
          { id: 'pep', n: 'Pizza de pepperoni', d: 'Grande · 8 rebanadas', p: 229, ic: '🍕' },
          { id: 'veg', n: 'Pizza vegetariana', d: 'Grande · pimiento, champiñón y aceituna', p: 219, ic: '🥗' },
          { id: 'ref', n: 'Refresco 2 L', d: 'Bien frío', p: 45, ic: '🥤' }
        ] } },
    { n: 7, name: 'Clásicos 7', show: 'Volver al futuro', tmdb: 105, next: 'Concierto en vivo', art: ['#7CC7A8', '#174536'],
      offer: { kind: 'facts', facts: [
        'Eric Stoltz fue el primer Marty McFly: filmó varias semanas antes de que lo reemplazara Michael J. Fox.',
        'En los primeros borradores del guion, la máquina del tiempo era un refrigerador, no un DeLorean.',
        'Michael J. Fox grababa la serie Family Ties de día y la película de noche.',
        'El DeLorean tiene que llegar a 88 millas por hora (unos 141 km/h) para viajar en el tiempo.',
        'El condensador de flujo necesita 1.21 gigawatts para funcionar.',
        'Fue la película más taquillera de 1985 en Estados Unidos.'
      ] } },
    { n: 9, name: 'Estilo 9', show: 'El diablo viste a la moda', tmdb: 350, next: 'Desfile de temporada', art: ['#F0A6C8', '#5A2440'],
      offer: { kind: 'shop', who: 'Andy', products: [
        { n: 'Abrigo largo color camel', d: 'Tallas CH a G', p: 1899, ic: '🧥', c: ['#C8A27A', '#7A5A3A'] },
        { n: 'Botas altas negras', d: 'Piel sintética · del 23 al 27', p: 1499, ic: '👢', c: ['#3A3440', '#141018'] },
        { n: 'Bolso estructurado', d: 'Color vino', p: 1299, ic: '👜', c: ['#9A2A4A', '#4A1020'] }
      ] } }
  ];
  /* El partido ya no es canal: es un evento en vivo propio (con sus estadísticas en el celular). Al pausarlo sugiere la repetición en Anytime. */
  var MATCH_SRC = { n: 'match', name: 'En vivo', show: 'Halcones vs. Toros', art: ['#2E7D49', '#123A22'],
    offer: { kind: 'anytime', title: 'Halcones vs. Toros', min: 110, line: 'La repetición completa del partido' } };
  function offerSource(id) { return id === 'match' ? MATCH_SRC : channel(Number(id)); }
  function channel(n) { for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].n === n) return CHANNELS[i]; return null; }

  /* Apps de streaming instaladas en el decodificador. Abrirlas se simula (la API de Totalplay para lanzar apps está pendiente). */
  var APPS = [
    { id: 'netflix', kind: 'app', title: 'Netflix', sub: 'App', tag: 'App', color: '#E50914' },
    { id: 'prime', kind: 'app', title: 'Prime Video', sub: 'App', tag: 'App', color: '#1A98FF' },
    { id: 'youtube', kind: 'app', title: 'YouTube', sub: 'App', tag: 'App', color: '#FF0033' }
  ];
  var LIVE = { id: 'tv', kind: 'live', title: 'TV en vivo', sub: 'Canales 2 · 5 · 7 · 9', tag: 'Canales' };

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
    if (id === 'recipe') return RECIPE;
    if (id === 'ship') return SHIP;
    for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i];
    return null;
  }
  function all() { return [SERIES, BUNNY, RECIPE, MATCH, LIVE].concat(APPS).concat([GAME, SHIP, SWIPE]); }

  CP.content = { MATCH: MATCH, SERIES: SERIES, GAME: GAME, SWIPE: SWIPE, SHIP: SHIP, offerSource: offerSource, BUNNY: BUNNY, RECIPE: RECIPE, recipeStep: recipeStep, MOVIES: MOVIES, recommend: recommend, movieById: movieById, GENRE_NAMES: GENRE_NAMES, CHANNELS: CHANNELS, channel: channel, APPS: APPS, LIVE: LIVE, sceneAt: sceneAt, fmt: fmt, byId: byId, all: all };
})(window.CP = window.CP || {});
