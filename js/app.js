/**
 * app.js — Punto de entrada: navegación entre pantallas, identificación del jugador,
 * selección de modo, animación de introducción y conexión de los módulos.
 */
import { getBackend, loadLocalBank } from './database.js';
import { GameController, renderResults } from './game.js';
import { RankingView } from './ranking.js';
import { loadStats } from './statistics.js';
import { sound } from './sound.js';
import { music } from './music.js';
import { storage } from './storage.js';
import { RULES } from './scoring.js';
import { $, $$, el, escapeHtml, validateName, shuffle, resolveImageUrl, NAME_MAX, MODE_LABELS, DIFFICULTY_LABELS } from './utils.js';

const ROUTES = { home: '', ranking: 'ranking', howto: 'como-jugar', stats: 'estadisticas', credits: 'creditos', name: 'jugar' };
const SCREEN_BY_ROUTE = Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [v, k]));

const app = {
  screen: null,
  player: storage.lastName(),
  lastGame: null,
  controller: null,
};

/* -------------------- Utilidades de interfaz -------------------- */

function toast(message, type = 'info') {
  const box = $('#toasts');
  const t = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4400);
}

function show(name, { push = true } = {}) {
  if (app.screen === 'ranking' && name !== 'ranking') ranking.close();
  if (app.screen === 'game' && name !== 'game' && name !== 'results' && app.controller?.state && !app.controller.state.ended) {
    app.controller.state.ended = true;
    app.controller._cleanup();
  }
  $$('.screen').forEach((s) => {
    const active = s.id === `screen-${name}`;
    s.hidden = !active;
    s.classList.toggle('active', active);
  });
  document.body.dataset.screen = name;
  music.play(name === 'game' ? 'suspense' : 'menu');
  app.screen = name;
  if (name !== 'home') intro.stop(); else intro.start();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  const route = ROUTES[name];
  if (push && route !== undefined && location.hash.replace(/^#\/?/, '') !== route) {
    history.pushState({ screen: name }, '', route ? `#/${route}` : location.pathname + location.search);
  }
  const heading = $(`#screen-${name} h1, #screen-${name} h2`);
  heading?.setAttribute('tabindex', '-1');
  if (name !== 'home' && name !== 'game') heading?.focus({ preventScroll: true });
  // Carga de contenido por pantalla
  if (name === 'ranking') ranking.open(app.rankingOpts || {});
  if (name === 'stats') loadStats(getBackend);
  if (name === 'credits') loadCredits();
  if (name === 'name') prepareNameScreen();
  app.rankingOpts = null;
}

window.addEventListener('popstate', () => {
  const route = location.hash.replace(/^#\/?/, '');
  const screen = SCREEN_BY_ROUTE[route] || 'home';
  if (app.screen === 'game' && app.controller?.state && !app.controller.state.ended) {
    if (!confirm('¿Abandonar la partida? No se guardará el resultado.')) {
      history.pushState({}, '', '#/jugar');
      return;
    }
  }
  show(screen, { push: false });
});

/* -------------------- Animación de introducción -------------------- */

const intro = {
  timer: null,
  images: [],
  i: 0,
  async load() {
    try {
      const { questions } = await loadLocalBank({ checkImages: false });
      // Mezcla imágenes reales y generadas SIN revelar cuál es cuál.
      const real = shuffle(questions.filter((q) => !q.is_ai)).slice(0, 4);
      const ai = shuffle(questions.filter((q) => q.is_ai)).slice(0, 4);
      this.images = shuffle([...real, ...ai]).map((q) => resolveImageUrl(q.file));
    } catch { this.images = []; }
    const stack = $('#intro-stack');
    stack.replaceChildren(...this.images.map((src, k) => el('img', { src, alt: '', class: k === 0 ? 'on' : '', loading: k < 2 ? 'eager' : 'lazy', decoding: 'async' })));
    if (app.screen === 'home') this.start();
  },
  start() {
    if (this.timer || this.images.length < 2) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.timer = setInterval(() => {
      const imgs = $$('#intro-stack img');
      if (!imgs.length) return;
      imgs[this.i % imgs.length].classList.remove('on');
      this.i += 1;
      imgs[this.i % imgs.length].classList.add('on');
      const label = $('#intro-label');
      label.textContent = this.i % 2 ? '¿IA?' : '¿REAL?';
      label.classList.remove('flip'); void label.offsetWidth; label.classList.add('flip');
    }, 2200);
  },
  stop() { clearInterval(this.timer); this.timer = null; },
};

/* -------------------- Identificación del jugador -------------------- */

function prepareNameScreen() {
  const input = $('#player-name');
  input.value = app.player || storage.lastName() || '';
  $('#name-error').textContent = '';
  input.setAttribute('aria-invalid', 'false');
  $('#name-counter').textContent = `${[...input.value].length}/${NAME_MAX}`;
  setTimeout(() => input.focus(), 60);
}

function bindNameForm() {
  const input = $('#player-name');
  input.maxLength = NAME_MAX;
  input.addEventListener('input', () => {
    $('#name-counter').textContent = `${[...input.value].length}/${NAME_MAX}`;
    if ($('#name-error').textContent) {
      const v = validateName(input.value);
      $('#name-error').textContent = v.ok ? '' : v.error;
      input.setAttribute('aria-invalid', String(!v.ok));
    }
  });
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = validateName(input.value);
    if (!v.ok) {
      $('#name-error').textContent = v.error;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      $('#name-form').classList.remove('shake'); void input.offsetWidth; $('#name-form').classList.add('shake');
      return;
    }
    app.player = v.value;
    storage.setLastName(v.value);
    sound.play('click');
    goToModes(true);
  });
}

function goToModes(isNew) {
  const hello = $('#welcome-title');
  hello.textContent = `¡Hola, ${app.player}!`;
  $('#welcome-sub').textContent = isNew
    ? 'Te damos la bienvenida a REAL OR AI. Elegí cómo querés jugar.'
    : 'Elegí un modo y una dificultad para la próxima partida.';
  show('mode');
}

/* -------------------- Selección de modo y dificultad -------------------- */

function bindModeScreen() {
  const prefs = storage.prefs();
  const diff = $(`input[name="difficulty"][value="${prefs.difficulty}"]`);
  if (diff) diff.checked = true;
  $$('input[name="difficulty"]').forEach((r) => r.addEventListener('change', () => storage.setPref('difficulty', r.value)));
  $('#btn-change-name').addEventListener('click', () => show('name'));
  $('#mode-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = $('input[name="mode"]:checked')?.value || 'classic';
    const difficulty = $('input[name="difficulty"]:checked')?.value || 'mixed';
    await startGame({ mode, difficulty });
  });
}

async function startGame({ mode, difficulty }) {
  const btn = $('#btn-start');
  btn.disabled = true;
  btn.classList.add('loading');
  sound.unlock();
  try {
    const backend = await getBackend();
    if (!backend.report?.playable) throw new Error('El banco de imágenes no está completo. Revisá la consola o el panel de administración.');
    if (!app.controller) {
      app.controller = new GameController({
        backend, show: (s) => show(s, { push: s !== 'game' }), toast,
        onFinish: (summary, ctx) => {
          app.lastGame = { mode: ctx.mode, difficulty: ctx.difficulty };
          renderResults(summary, ctx);
          show('results', { push: false });
        },
      });
    }
    app.lastGame = { mode, difficulty };
    await app.controller.start({ name: app.player, mode, difficulty });
    history.pushState({ screen: 'game' }, '', '#/jugar');
  } catch (err) {
    toast(err.message || 'No se pudo iniciar la partida.', 'error');
    if (app.screen === 'game') show('mode', { push: false });
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

/* -------------------- Créditos -------------------- */

async function loadCredits() {
  const box = $('#credits-body');
  box.innerHTML = '<p class="loading-row"><span class="spinner"></span> Cargando créditos…</p>';
  try {
    const backend = await getBackend();
    const list = await backend.getCredits();
    // Orden alfabético (no se revela qué imagen corresponde a cada clasificación).
    list.sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const link = (u, t) => (u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t)}</a>` : escapeHtml(t || '—'));
    box.innerHTML = `<table class="credits-table"><thead><tr><th>Imagen</th><th>Autor / generador</th><th>Fuente</th><th>Licencia</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${escapeHtml(c.title)}</td><td>${escapeHtml(c.author || '—')}</td><td>${link(c.source_url, c.source)}</td><td>${link(c.license_url, c.license)}</td></tr>`).join('')}
    </tbody></table>`;
  } catch (e) {
    box.innerHTML = `<p class="error-box">${escapeHtml(e.message)}</p>`;
  }
}

/* -------------------- Inicialización -------------------- */

const ranking = new RankingView(getBackend);

function bindGlobal() {
  const unlockAudio = () => { sound.unlock(); music.unlock(); };
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  $$('[data-go]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    sound.play('click');
    const target = b.dataset.go;
    if (target === 'play') return app.player ? goToModes(false) : show('name');
    show(target);
  }));
  const st = $('#btn-sound');
  const paint = () => {
    st.setAttribute('aria-pressed', String(sound.enabled));
    st.title = sound.enabled ? 'Desactivar sonido' : 'Activar sonido';
    st.querySelector('.ico').textContent = sound.enabled ? '🔊' : '🔇';
  };
  st.addEventListener('click', () => { sound.toggle(); paint(); sound.play('click'); });
  paint();
  const mb = $('#btn-music');
  const paintMusic = () => {
    mb.setAttribute('aria-pressed', String(music.enabled));
    mb.title = music.enabled ? 'Desactivar música' : 'Activar música';
    mb.classList.toggle('off', !music.enabled);
  };
  mb.addEventListener('click', () => { music.toggle(); paintMusic(); });
  paintMusic();

  $('#btn-play-again').addEventListener('click', () => startGame(app.lastGame || { mode: 'classic', difficulty: 'mixed' }));
  $('#btn-results-ranking').addEventListener('click', () => {
    app.rankingOpts = { mode: app.lastGame?.mode, highlight: app.player };
    show('ranking');
  });
  $('#btn-results-home').addEventListener('click', () => show('home'));
  $('#btn-results-modes').addEventListener('click', () => goToModes(false));

  // Textos de reglas tomados de scoring.js (fuente única)
  $$('[data-rule]').forEach((n) => {
    const map = {
      base: RULES.BASE_POINTS, speed: RULES.SPEED_BONUS, s3: RULES.STREAK_BONUSES[3], s5: RULES.STREAK_BONUSES[5],
      time: RULES.CLASSIC_TIME_MS / 1000, ta: RULES.TIMEATTACK_MS / 1000, n: RULES.CLASSIC_QUESTIONS,
    };
    n.textContent = map[n.dataset.rule];
  });
}

async function init() {
  bindGlobal();
  bindNameForm();
  bindModeScreen();
  const route = location.hash.replace(/^#\/?/, '');
  const initial = SCREEN_BY_ROUTE[route] && route !== 'jugar' ? SCREEN_BY_ROUTE[route] : 'home';
  history.replaceState({ screen: initial }, '', initial === 'home' ? location.pathname + location.search : `#/${ROUTES[initial]}`);
  show(initial, { push: false });
  intro.load();

  const status = $('#conn-status');
  try {
    const backend = await getBackend();
    status.className = `pill ${backend.kind === 'online' ? 'online' : 'local'}`;
    status.textContent = backend.kind === 'online' ? '● En línea' : '● Modo local';
    status.title = backend.kind === 'online'
      ? 'Conectado a Supabase: ranking global compartido entre dispositivos.'
      : 'Sin Supabase configurado: el ranking se guarda solo en este dispositivo.';
    const r = backend.report;
    $('#bank-status').textContent = `${r.valid} imágenes verificadas (${r.real} reales · ${r.ai} IA)`;
    if (!r.playable) {
      $('#btn-play').disabled = true;
      toast('El banco de imágenes no está completo: el juego queda deshabilitado.', 'error');
    }
  } catch (e) {
    status.className = 'pill error';
    status.textContent = '● Sin conexión';
    $('#btn-play').disabled = true;
    toast(e.message || 'No se pudo cargar el juego.', 'error');
  }
}

init();

// Exposición mínima para pruebas automatizadas (no afecta al juego).
window.__REALORAI__ = { app, getBackend, music, MODE_LABELS, DIFFICULTY_LABELS };
