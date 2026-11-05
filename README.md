# ¿Qué vemos?

Juego para elegir película entre amigos: cada quien desliza en su celular y al final ven en qué coincidieron y en qué plataforma está.

- **`index.html`** — el juego en el celular (crear sala / unirse, géneros, swipe, resultados).
- **`tv.html`** — la pantalla de TV para la STB de Totalplay: crea la sala, muestra el QR para unirse, enseña en vivo quién va entrando y deslizando, y al terminar lista las coincidencias con botones "Ver en…" por plataforma.

Datos de películas: [TMDB](https://www.themoviedb.org/). Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.

## TV (STB Totalplay) — cómo probar

Siempre con un servidor HTTP real (regla R7), nunca abriendo el archivo directo:

```
python3 -m http.server 8765
```

- `http://localhost:8765/tv.html?demo=1` → TV en modo demo (sin Firebase ni TMDB; comparte `localStorage` con `index.html?demo=1`, así que los "celulares" pueden ser pestañas del mismo navegador).
- `http://localhost:8765/tv.html` → TV real: sala en Firebase, catálogo TMDB; el QR lleva a `…/?sala=CODIGO` para escanear con celulares reales.

Control en escritorio: flechas = D-pad, Enter = OK, Backspace/Esc = BACK (solo fuera del STB). Mouse opcional, protegido con `matchMedia('(hover: hover) and (pointer: fine)')`.

## Estructura (AI Guide §23)

```
tv.html                       entrada de la TV
tv/tv.css, tv/app.js          UI + lógica (nunca llama sagem.*)
src/platform/totalplay/       adaptador de plataforma — lo único que puede tocar sagem.*
  keys.js      mapa de teclas del control (§6)
  focus.js     FocusManager espacial sobre [data-focusable] (§7, §8)
  lifecycle.js standby/wakeup (§11) + BACK/MENU vacíos (R6)
  device.js    identificación + HDMI, con mock fuera del STB (§9, §10, §24)
  network.js   estado de red por polling (§12)
  debug.js     log serial solo en STB de desarrollo (§16)
  apps.js      abrir Netflix/Prime/… — TBD/BLOCKED, ver abajo
src/services/                 http (XHR), Firestore REST con polling, demo-store, catálogo TMDB
fonts/                        Montserrat autohospedada (R1)
vendor/qrcode.js              generador de QR ES5 (sin CDN)
```

## Pendientes marcados TBD (no se inventaron)

- **Abrir apps de terceros desde la web app** (`src/platform/totalplay/apps.js`): ninguna fuente documenta una API; el PDF de integración indica que el Portal de Totalplay es quien cede el control a las apps. En la demo el botón muestra una pantalla de confirmación simulada. Cuando ingeniería confirme la API, se conecta ahí y el resto no cambia.
- Soporte en el runtime Opera del STB de: XHR con CORS hacia `firestore.googleapis.com` / `api.themoviedb.org` / `image.tmdb.org`, flexbox, variables CSS, `clamp()`, `getComputedStyle`, `matchMedia`, woff2 (hay woff de respaldo y Arial como fallback). Todo tiene fallback razonable o degrada; nada probado en hardware todavía.
- Red de producción (HTTPS/CORS/allowlist): usar solo la URL que apruebe ingeniería.

## Companion (prototipo celular + TV) — `companion/`

Prototipo para explorar cómo el celular puede trabajar con la TV de Totalplay. La TV simula la STB y el celular funciona como Companion; se comunican en tiempo real por el mismo Firebase del juego (`rooms/{código}` y `rooms/{código}/players/{id}`, con polling por REST).

- **`companion/tv.html`** — pantalla de TV (ES5, lineamientos de la STB: Montserrat local, sin blur, navegación con D-pad). Muestra un QR para vincular celulares.
- **`companion/index.html`** — el Companion en el celular (se abre al escanear el QR).

Flujos incluidos (ideas priorizadas en la votación del workshop):

| Idea | Qué pasa |
|---|---|
| A1 · Datos de lo que ves | En el partido en vivo, el celular muestra alineación, estadísticas y datos; la TV avisa quién está consultando. |
| A2 · Pausa enriquecida | Al pausar Marea Alta (desde la TV o “Pausar y descubrir” en el celular), la TV muestra personajes, canción y productos de la escena. |
| A4 · Está sonando | Al cambiar de escena, la canción llega al celular como aviso para guardarla en tu soundtrack. |
| B1 · Control inteligente | D-pad, OK, regresar, inicio, play/pausa y búsqueda escribiendo en el celular. |
| B3 · Continuar donde lo dejaste | Al abrir Marea Alta, la TV ofrece continuar; también se puede continuar desde la pestaña “Seguir viendo” del celular. |
| C2 · Control de videojuegos | “Atrapa estrellas”: cada celular es un control y mueve su canasta en la TV (1 a 4 jugadores). |

Todo el contenido (equipos, series, actores, canciones y productos) es ficticio.

**Probar:** abrir `…/companion/tv.html` en la compu (pantalla completa) y escanear el QR con uno o varios celulares. Control desde el teclado: flechas, Enter (OK) y Retroceso (BACK).
**Ensayo sin celulares:** `…/companion/tv.html?demo=1` y abrir el link bajo el QR en otras pestañas del mismo navegador (cada pestaña es un celular).
