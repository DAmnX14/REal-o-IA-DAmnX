# REAL OR AI – ¿Podés distinguir lo real de lo artificial?

Videojuego web educativo y competitivo: en cada ronda aparece una imagen y hay que decidir si es una
**fotografía real** o una imagen **generada por inteligencia artificial**. Después de cada respuesta,
el juego explica la clasificación verdadera, el contexto y la procedencia documentada de la imagen.

- HTML5 + CSS3 + JavaScript moderno (módulos ES), **sin frameworks ni paso de compilación**.
- **Supabase** (PostgreSQL + Auth + Storage) para el ranking global, las estadísticas y el panel de administración.
- Funciona también **sin Supabase** (modo local) para desarrollo o demos: el ranking queda solo en el dispositivo y la interfaz lo indica.
- Listo para **GitHub Pages, Vercel o Netlify**.

---

## Contenido

1. [Funcionalidades](#funcionalidades)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Banco de imágenes](#banco-de-imágenes)
4. [Puesta en marcha local](#puesta-en-marcha-local)
5. [Configurar Supabase](#configurar-supabase)
6. [Publicar el juego](#publicar-el-juego)
7. [Panel de administración](#panel-de-administración)
8. [Seguridad y anti-trampas](#seguridad-y-anti-trampas)
9. [Pruebas](#pruebas)
10. [Créditos y licencias](#créditos-y-licencias)

---

## Funcionalidades

| Área | Detalle |
|---|---|
| Inicio | Logo, eslogan, animación de imágenes reales e IA alternándose (sin revelar cuál es cuál), botones Jugar ahora / Ranking global / Cómo jugar / Estadísticas, acceso a administración. |
| Jugador | Nombre o apodo obligatorio (3–20 caracteres, solo letras, números, espacio, `.`, `_`, `-`), validado en el navegador **y** en el servidor. Se recuerda el último nombre. Sin correo ni contraseña. Bienvenida personalizada. |
| Modo clásico | 10 imágenes (5 reales + 5 IA), 15 s por imagen, bonus por rapidez y rachas, suma al ranking global. |
| Modo contrarreloj | 60 s para responder todas las imágenes posibles; ranking propio. |
| Modo aprendizaje | Sin reloj, guía de observación y explicaciones ampliadas. No afecta el ranking. |
| Dificultad | Mixta, Fácil, Intermedio o Difícil. |
| Mecánica | Imagen grande, botones REAL / GENERADA POR IA (también teclas `R` / `I`), temporizador circular, barra de tiempo y de progreso, puntaje, número de pregunta, racha y nombre del jugador. Cada pregunta se responde **una sola vez**. Al agotarse el tiempo: no respondida, 0 puntos, se muestra la respuesta y la explicación. |
| Devolución | En los modos Clásico y Contrarreloj, explicación mínima (resultado, sello REAL/IA, la pista clave y los puntos) que **pasa sola a la siguiente imagen a los 5 segundos** (botón SIGUIENTE para adelantar). En el modo Aprendizaje, explicación completa sin avance automático. Pantalla compacta y animada (ícono que se dibuja, sello REAL / IA, puntos ganados) con la explicación principal a la vista y el resto en pestañas: qué observar, consejos, contexto y procedencia. Incluye CORRECTO / INCORRECTO / TIEMPO AGOTADO, clasificación verdadera, explicación específica de esa imagen, contexto, características a observar, consejos, autor, fuente, licencia y herramienta de IA. Botón CONTINUAR. |
| Resultados | Puntaje, correctas, incorrectas, sin responder, % de aciertos, tiempo promedio, mejor racha, duración, calificación, posición en el ranking, revisión de todas las imágenes. Volver a jugar / Ver ranking / Volver al inicio. Celebración con confeti. |
| Ranking | Global (Supabase), por modo, mejor partida de cada jugador, orden por puntaje → % aciertos → menor tiempo promedio, oro/plata/bronce, buscador, paginación y actualización automática cada 20 s. |
| Estadísticas | Partidas, jugadores, puntaje promedio, % de aciertos (general, IA y reales), distribución de respuestas (gráfico circular), aciertos por categoría (barras), evolución diaria (línea), preguntas con más errores e imágenes que más confunden. Gráficos interactivos con tooltip y tabla accesible. |
| Fondo y animaciones | Fondo animado futurista (aurora neón violeta/cian/rosa, grilla en movimiento y estrellas), botones con degradado animado, borde de luz giratorio, onda al tocar y brillo. El botón ✨ activa o desactiva las animaciones (vienen activadas aunque el sistema operativo las tenga apagadas). |
| Música | Tema de inicio y música de suspenso durante la partida (más intensa en los últimos 5 segundos), generadas en tiempo real con Web Audio API (sin archivos ni licencias). Se baja el volumen mientras se lee la explicación. Botón 🎵 para activarla o desactivarla. |
| Efectos | Sonidos sintetizados (sin archivos) desactivables, cuenta regresiva sonora, animaciones de acierto/error, puntos flotantes, banner de racha, transiciones y confeti. Respeta `prefers-reduced-motion`. |
| Responsive | Diseñado y probado en escritorio y celular. |

### Puntuación

| Evento | Puntos |
|---|---|
| Respuesta correcta | +100 |
| Respuesta incorrecta o sin responder | 0 |
| Correcta con **más de 10 s restantes** (respondida en menos de 5 s, modo clásico) | +50 |
| Al alcanzar una racha de 3 correctas seguidas | +50 |
| Al alcanzar una racha de 5 correctas seguidas | +100 |

Partida perfecta en modo clásico: 10 × 150 + 50 + 100 = **1650 puntos**. Las reglas están en
`js/scoring.js` y **replicadas en el servidor** (`supabase/schema.sql`, función `_rule`); una prueba
automática verifica que coincidan. El tiempo promedio se calcula sobre las imágenes respondidas.

Calificación final: 0–3 aciertos «¡Todavía hay mucho por descubrir!», 4–6 «¡Vas por buen camino!»,
7–8 «¡Tenés muy buen ojo!», 9–10 «¡Experto en detectar IA!».

---

## Estructura del proyecto

```
REAL-OR-AI/
├── index.html                 Juego (pantallas: inicio, nombre, modos, juego, resultados, ranking, cómo jugar, estadísticas, créditos)
├── admin/index.html           Panel de administración
├── css/
│   ├── styles.css             Tema, componentes y pantallas
│   ├── animations.css         Animaciones
│   ├── responsive.css         Adaptación a tablet y celular
│   └── admin.css              Estilos del panel
├── js/
│   ├── app.js                 Navegación, nombre, modos, intro, resultados
│   ├── game.js                Controlador de partida, devolución educativa, resultados
│   ├── timer.js               Cuenta regresiva y cronómetro precisos
│   ├── scoring.js             Reglas de puntuación (fuente única en el cliente)
│   ├── selection.js           Selección aleatoria equilibrada
│   ├── database.js            Capa de datos: Supabase (en línea) o local
│   ├── ranking.js             Ranking (tabla, búsqueda, paginación, auto-actualización)
│   ├── statistics.js          Estadísticas
│   ├── charts.js              Gráficos SVG interactivos (sin dependencias)
│   ├── effects.js             Confeti, puntos flotantes, contadores
│   ├── sound.js               Sonidos con Web Audio API
│   ├── music.js               Música de inicio y de suspenso (Web Audio API)
│   ├── storage.js             Preferencias locales (nombre, sonido, dificultad)
│   ├── utils.js               Validación, sanitización, formato
│   ├── admin.js               Lógica del panel
│   ├── config.js              URL y clave pública de Supabase
│   └── vendor/supabase.js     supabase-js 2 (copia local, sin CDN)
├── data/questions.json        Banco de imágenes (50) con todos los metadatos
├── assets/
│   ├── images/bank/           Las 50 imágenes (nombres neutros, ver abajo)
│   ├── icons/                 Logo y favicon (SVG)
│   └── sounds/                (vacío: los sonidos se sintetizan en el navegador)
├── supabase/
│   ├── schema.sql             Tablas, funciones seguras, RLS y Storage
│   └── seed.sql               Carga de las 50 preguntas (generado)
├── scripts/                   serve, verify-bank, build-seed, build-config
├── tests/                     unitarias, E2E (Playwright), SQL y entorno en línea local
├── vercel.json · netlify.toml · .github/workflows/pages.yml
└── README.md
```

> **Cambio respecto de la estructura propuesta:** las imágenes no se guardan en `images/real/` e
> `images/ai/`, sino todas juntas en `assets/images/bank/` con nombres neutros (p. ej. `3f9a1c0b2e7d.jpg`).
> Si las carpetas indicaran la respuesta, cualquiera podría verla en la URL de la imagen. La
> clasificación vive solo en `data/questions.json` y en la base de datos.

---

## Banco de imágenes

**50 imágenes: 25 fotografías reales y 25 imágenes generadas por IA**, distribuidas en
**Fácil 10 (5+5) · Intermedio 20 (10+10) · Difícil 20 (10+10)** y en las 10 categorías temáticas.
Cada entrada de `data/questions.json` tiene: `id`, `file`, `classification` (REAL/IA), `category`,
`difficulty`, `title`, `context`, `explanation`, `features`, `tips`, `source`, `source_url`, `author`,
`license`, `license_url`, `ai_tool`, `added_at`.

**Procedencia**

- **Fotografías reales:** Wikimedia Commons (en su mayoría *Featured pictures*). El autor, la licencia
  y la descripción se extrajeron automáticamente de la página de cada archivo; no se inventó ningún dato.
  Licencias: CC BY-SA, CC BY, CC0, dominio público y FAL. Todas exigen o permiten atribución, que
  se muestra tras cada respuesta y en la pantalla **Créditos**.
- **Imágenes generadas por IA:** una fue generada para este proyecto con el generador de imágenes de
  Canva. El resto proviene de Wikimedia Commons, donde **el propio autor declara que la imagen fue
  generada por IA** e indica la herramienta (Midjourney, DALL·E, Stable Diffusion/SDXL, FLUX,
  Adobe Firefly, Gemini/Nano Banana, Meta AI, Grok, ChatGPT, Craiyon, StyleGAN2, etc.) y en muchos
  casos el prompt. Se descartaron los archivos cuya única evidencia de IA era una categoría agregada
  por terceros, y también los que tenían marcas de agua visibles.
- Las imágenes se redimensionaron (máx. 1280 px), se recomprimieron en JPEG y se les quitaron los
  metadatos EXIF; no se modificó su contenido.
- La dificultad es una evaluación editorial (qué tan evidentes son las pistas visuales) y puede
  ajustarse con las estadísticas reales de aciertos desde el panel.

`node scripts/verify-bank.mjs` comprueba que las 50 imágenes existan, se puedan abrir, tengan
resolución suficiente, estén clasificadas con procedencia registrada (IA ⇒ herramienta; REAL ⇒
autor), que los nombres de archivo no revelen la respuesta y que se cumplan las cantidades. El
juego además verifica al iniciar que cada archivo exista (modo local) o consulta el banco publicado
(modo en línea), y **se deshabilita** si no hay al menos 5 imágenes de cada tipo.

---

## Puesta en marcha local

No hay dependencias que instalar para jugar. Solo hace falta un servidor estático (los módulos ES
no funcionan abriendo el HTML con doble clic):

```bash
node scripts/serve.mjs 8080
```

Abrí <http://localhost:8080>. Sin configurar Supabase, el juego funciona en **modo local**.
(Alternativas: `npx serve .` o `python3 -m http.server 8080`.)

---

## Configurar Supabase

### 1. Crear el proyecto
1. Creá una cuenta y un proyecto en <https://supabase.com>.
2. En **Project Settings → API** copiá la **Project URL** y la clave **anon / publishable**.
   **Nunca** uses ni publiques la clave `service_role` / secreta.

### 2. Crear las tablas y funciones
En **SQL Editor → New query**, pegá y ejecutá el contenido completo de `supabase/schema.sql`. Crea:

| Tabla | Para qué |
|---|---|
| `questions` | Banco de imágenes/preguntas (clasificación, textos, procedencia, activa/inactiva) |
| `players` | Jugadores: apodo + identificador anónimo del dispositivo (sin email) |
| `games` | Partidas: modo, dificultad, puntaje, aciertos, racha, tiempos, moderación |
| `game_answers` | Resultados por imagen: cuándo se mostró, qué respondió, tiempo, puntos |
| `admins` | Usuarios de Supabase Auth con permiso de administración |

Además crea las funciones RPC del juego (`start_game`, `next_question`, `submit_answer`,
`finish_game`, `get_ranking`, `get_public_stats`, `get_credits`, `get_bank_info`, `admin_stats`),
las políticas RLS y el bucket de Storage `question-images`.

### 3. Cargar las 50 imágenes iniciales
En el SQL Editor ejecutá `supabase/seed.sql` (si modificás `data/questions.json`, regeneralo con
`node scripts/build-seed.mjs`). Las imágenes iniciales se sirven desde el propio sitio
(`assets/images/bank/`), por eso no hace falta subirlas a Storage. Las imágenes nuevas que agregues
desde el panel sí se suben al bucket `question-images`.

### 4. Almacenamiento (Storage)
`schema.sql` ya crea el bucket público `question-images` con lectura pública y escritura solo para
administradores. Si tu proyecto no permite crear buckets por SQL, crealo a mano en **Storage → New
bucket** (nombre `question-images`, público) y volvé a ejecutar `schema.sql` para aplicar las políticas.

### 5. Crear el administrador
1. **Authentication → Users → Add user** (correo + contraseña, marcá *Auto confirm*).
2. En el SQL Editor:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'tu-correo@ejemplo.com';
   ```
3. Recomendado: en **Authentication → Providers → Email** desactivá *Allow new users to sign up*
   (los administradores se crean a mano).

### 6. Configurar el frontend
Opción A — editar `js/config.js`:
```js
export const CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-CLAVE-ANON',
  OFFLINE_FALLBACK: false, // en producción: no permitir jugar "en local" si Supabase falla
};
```
Opción B — variables de entorno (Vercel, Netlify, GitHub Actions):
```bash
SUPABASE_URL=https://TU-PROYECTO.supabase.co SUPABASE_ANON_KEY=TU-CLAVE-ANON OFFLINE_FALLBACK=false node scripts/build-config.mjs
```
El script rechaza claves con rol `service_role`.

Al recargar el juego, el indicador superior debe decir **● En línea**.

---

## Publicar el juego

Antes de publicar: `node scripts/verify-bank.mjs` (lo ejecutan también los builds de abajo).

**GitHub Pages**
1. Subí el proyecto a un repositorio de GitHub.
2. *Settings → Pages → Source:* **GitHub Actions**.
3. *Settings → Secrets and variables → Actions:* creá `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
4. Cada push a `main` publica con `.github/workflows/pages.yml`.
   (Alternativa sin Actions: completar `js/config.js`, hacer commit y elegir *Deploy from a branch*.)

**Vercel**
1. *Add New → Project* e importá el repositorio (Framework preset: **Other**).
2. En *Environment Variables* agregá `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `OFFLINE_FALLBACK=false`.
3. Deploy. `vercel.json` ya define el comando de build y la carpeta de salida (`.`).

**Netlify**
1. *Add new site → Import an existing project*.
2. En *Site configuration → Environment variables* agregá las mismas variables.
3. Deploy. `netlify.toml` ya define el build y los encabezados.

Después de publicar, agregá la URL del sitio en **Supabase → Authentication → URL Configuration →
Site URL** (lo usa el inicio de sesión del panel).

---

## Panel de administración

`/admin/` (enlace «🔒 Administración» al pie de la pantalla de inicio). Requiere iniciar sesión con
un usuario de Supabase Auth registrado en la tabla `admins`. Si la cuenta no es administradora, se
cierra la sesión.

- **Imágenes y preguntas:** listado con vista previa, búsqueda y filtros (clasificación, categoría,
  dificultad, estado); agregar pregunta nueva subiendo el archivo (JPG/PNG/WebP, máx. 5 MB, se guarda
  en Storage con nombre neutro) o indicando una ruta/URL; editar clasificación, contexto, explicación,
  características, consejos, dificultad, categoría y procedencia; activar/desactivar; eliminar.
  **El banco se amplía sin tocar el código.**
- **Jugadores:** listado, cantidad de partidas, mejores puntajes, suspender / rehabilitar (los
  suspendidos desaparecen del ranking y no pueden iniciar partidas).
- **Partidas:** filtros por modo y estado, detalle respuesta por respuesta (tiempos y puntos),
  marcar/desmarcar como fraudulenta (sale del ranking) y eliminar.
- **Estadísticas:** todas las públicas más partidas abandonadas, marcadas, jugadores suspendidos y
  el porcentaje de error real de cada imagen.

Sin Supabase configurado, el panel muestra las instrucciones y una vista **de solo lectura** del
banco local.

---

## Seguridad y anti-trampas

- **El navegador nunca envía puntajes.** El servidor elige las preguntas, registra la hora en que
  entrega cada imagen (`served_at`), corrige la respuesta y calcula los puntos dentro de funciones
  `SECURITY DEFINER`.
- **La respuesta correcta no viaja antes de responder:** `next_question` devuelve solo la URL de la
  imagen. Los nombres de archivo son neutros.
- **Tiempos verificados en el servidor:** el cliente puede informar su tiempo (para descontar la
  latencia), pero nunca más de 1,5 s por debajo de lo que midió el servidor. Pasados 15 s, la
  respuesta cuenta como no respondida. En contrarreloj se rechazan respuestas fuera de los 60 s.
- **Una respuesta por imagen** (restricción única + bloqueo de fila), no se puede «saltar» una imagen
  pedida ni cerrar una partida incompleta, y cada partida pertenece a un dispositivo.
- **Sin acceso directo a tablas para el público:** RLS activado en todas las tablas; el rol `anon`
  solo puede ejecutar las RPC del juego. Las funciones internas tienen el permiso revocado.
- **Moderación:** partidas con tiempo promedio imposible (< 0,35 s) quedan marcadas automáticamente
  fuera del ranking; los administradores pueden marcar partidas y suspender jugadores.
- **Límite de abuso:** máx. 30 partidas por dispositivo cada 10 minutos; una sola partida activa por
  dispositivo. Sin registros duplicados: un jugador = apodo + dispositivo (único) y el ranking
  muestra la mejor partida de cada jugador.
- **Entradas saneadas:** apodo validado en cliente y servidor; todo texto externo se inserta en el
  DOM escapado.
- **Credenciales:** el frontend solo contiene la URL y la clave pública `anon`.

**Límites conocidos (honestos):** `data/questions.json` es público porque alimenta el modo local, la
animación de inicio y la carga inicial de la base de datos, así que alguien decidido podría
consultarlo para memorizar respuestas. Lo mismo ocurre con quien juegue muchas veces (las
explicaciones revelan las respuestas). Para un despliegue competitivo podés quitar ese archivo del
sitio publicado (el juego en línea no lo necesita para jugar) y ampliar el banco desde el panel. La
identificación de jugadores es anónima (sin cuentas), por lo que nadie es «dueño» de un apodo.

---

## Pruebas

| Comando | Qué prueba |
|---|---|
| `node scripts/verify-bank.mjs` | Integridad del banco de 50 imágenes (archivos, formato, resolución, clasificación, procedencia, cantidades). |
| `node --test tests/unit.test.mjs` | Puntuación, bonus, rachas, calificaciones, desempates, selección aleatoria (sin repetidas, 5/5, alternancia, variedad), validación de nombres y coincidencia de reglas cliente/servidor. |
| `psql -f tests/sql/test_rpc.sql` | Funciones del servidor en PostgreSQL: partida perfecta (1650), errores, tiempo agotado, tiempos manipulados, respuesta doble, dispositivo ajeno, contrarreloj, detección de bots, ranking (orden, búsqueda, paginación), estadísticas y permisos `anon`/admin. Requiere `tests/sql/supabase_stubs.sql` + `supabase/schema.sql`. |
| `node tests/e2e.mjs` | Navegador real (Playwright), escritorio y celular: nombre, partida clásica completa con aciertos, error, tiempo agotado y doble clic, puntaje esperado, devolución, resultados, ranking, búsqueda, persistencia, aprendizaje, contrarreloj de 60 s, estadísticas, créditos, panel y ausencia de errores JS. |
| `node tests/e2e-admin.mjs` | Panel de administración en línea: login (contraseña errónea y correcta), filtros, activar/desactivar, editar, crear con subida de archivo a Storage, eliminar, suspender jugador, marcar partida como fraude, estadísticas y cierre de sesión, todo a través de las políticas RLS reales. |
| `tests/online/harness.mjs` + `node tests/e2e.mjs` | La misma prueba E2E en **modo en línea** contra PostgreSQL + PostgREST locales (la misma API que usa Supabase), incluyendo ranking compartido entre dos «dispositivos». Ver `tests/README.md`. |

---

## Créditos y licencias

- © 2026 ArceTech® · Todos los derechos reservados.

- Código: MIT.
- Imágenes: cada una conserva su licencia original; autor, fuente y licencia se muestran tras cada
  respuesta y en la pantalla **Créditos** (`#/creditos`). Ver `data/questions.json`.
- supabase-js: MIT (`js/vendor/supabase-LICENSE.txt`).
- Tipografías Inter y Space Grotesk (Google Fonts, SIL Open Font License); si no cargan, se usan las del sistema.
