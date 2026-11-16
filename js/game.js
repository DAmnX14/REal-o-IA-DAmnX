/**
 * game.js — Controlador de una partida (pantalla de juego, devolución educativa y resultados).
 *
 * Flujo:  start() → [nextQuestion() → answer() → feedback → continuar]* → end() → resultados
 * El cálculo oficial de puntos lo hace el backend (servidor en modo en línea).
 */
import { Countdown, Stopwatch } from './timer.js';
import { RULES, rating } from './scoring.js';
import { sound } from './sound.js';
import { confetti, floatText, countUp, pulse } from './effects.js';
import { music } from './music.js';
import {
  $, el, escapeHtml, formatSeconds, formatDuration, formatPercent, preloadImage,
  CATEGORY_LABELS, DIFFICULTY_LABELS, MODE_LABELS, sleep,
} from './utils.js';

/** Guía general para el modo aprendizaje (se muestra antes de responder). */
export const LEARNING_CHECKLIST = [
  ['Manos y anatomía', 'Contá dedos, mirá uniones de brazos, dientes, orejas y ojos (pupilas, reflejos distintos en cada ojo).'],
  ['Texto y símbolos', 'Carteles, etiquetas y logos: en las imágenes generadas suelen ser ilegibles o tener letras inventadas.'],
  ['Física de la luz', 'Sombras que no coinciden con la fuente de luz, reflejos imposibles o brillos “de estudio” en escenas cotidianas.'],
  ['Texturas', 'Piel sin poros, pelo como pintado, superficies demasiado lisas o patrones que se repiten.'],
  ['Fondo y bordes', 'Objetos que se fusionan entre sí, estructuras que no tienen sentido, personas deformes al fondo.'],
  ['Contexto y procedencia', 'La prueba definitiva es la fuente: autor, fecha, lugar, metadatos y publicación original.'],
];

export class GameController {
  /**
   * @param {object} deps
   * @param {object} deps.backend   backend activo (database.js)
   * @param {(screen:string)=>void} deps.show  navegación entre pantallas
   * @param {(msg:string, type?:string)=>void} deps.toast
   * @param {(summary:object, ctx:object)=>void} deps.onFinish
   */
  constructor({ backend, show, toast, onFinish }) {
    this.backend = backend;
    this.show = show;
    this.toast = toast;
    this.onFinish = onFinish;
    this.state = null;
    this._bindUi();
  }

  _bindUi() {
    $('#btn-real').addEventListener('click', () => this.answer('real'));
    $('#btn-ai').addEventListener('click', () => this.answer('ai'));
    $('#btn-continue').addEventListener('click', () => this.continue());
    $('#btn-quit').addEventListener('click', () => this.quit());
    $('#btn-retry-image').addEventListener('click', () => this._showQuestion(this.state?.current, true));
    document.addEventListener('keydown', (e) => {
      if (!this.state || e.target.matches('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (this.state.phase === 'question') {
        if (k === 'r' || k === 'arrowleft') { e.preventDefault(); this.answer('real'); }
        if (k === 'i' || k === 'a' || k === 'arrowright') { e.preventDefault(); this.answer('ai'); }
      } else if (this.state.phase === 'feedback' && (k === 'enter' || k === ' ')) {
        e.preventDefault(); this.continue();
      }
    });
  }

  /* -------------------- Inicio -------------------- */

  async start({ name, mode, difficulty }) {
    this._cleanup();
    const info = await this.backend.startGame({ name, mode, difficulty });
    this.state = {
      ...info, name, phase: 'loading', score: 0, streak: 0, bestStreak: 0, answered: 0,
      history: [], current: null, startedAt: Date.now(), busy: false, ended: false,
    };
    document.body.dataset.mode = mode;
    $('#hud-player').textContent = name;
    $('#hud-mode').textContent = MODE_LABELS[mode];
    const sc = $('#hud-score'); sc.dataset.value = 0; sc.textContent = '0';
    $('#hud-streak').textContent = '0';
    $('#hud-progress-fill').style.width = '0%';
    $('#learning-guide').hidden = mode !== 'learning';
    $('#learning-guide-list').replaceChildren(...LEARNING_CHECKLIST.map(([t, d]) => el('li', {}, el('strong', {}, t), ' — ', d)));
    this._setTimerDisplay(mode === 'classic' ? info.perQuestionMs : mode === 'timeattack' ? info.gameTimeMs : null, 1);
    this.show('game');

    if (mode === 'timeattack') {
      this.gameTimer = new Countdown(info.gameTimeMs, {
        onTick: (rem, f) => this._setTimerDisplay(rem, f),
        onSecond: (s) => { if (s <= 5 && s > 0) sound.play('tickUrgent'); },
        onExpire: () => this.end('time'),
      });
      this.gameTimer.start();
    }
    await this.next();
  }

  /* -------------------- Preguntas -------------------- */

  async next() {
    const st = this.state;
    if (!st || st.ended) return;
    st.phase = 'loading';
    this._setButtons(false);
    let q;
    try {
      q = await this.backend.nextQuestion(st.gameId);
    } catch (e) {
      if (st.ended) return;
      this.toast(e.message, 'error');
      if (st.mode === 'timeattack') return this.end('time');
      this._showRetry('No se pudo obtener la siguiente imagen.', () => this.next());
      return;
    }
    if (st.ended) return;
    if (q.done) return this.end(q.reason);
    st.current = q;
    await this._showQuestion(q);
  }

  async _showQuestion(q, retry = false) {
    const st = this.state;
    if (!q || !st) return;
    const stage = $('#stage');
    const img = $('#q-image');
    stage.classList.remove('is-correct', 'is-wrong', 'is-timeout', 'has-error');
    stage.classList.add('is-loading');
    $('#image-error').hidden = true;
    const ok = await preloadImage(q.imageUrl);
    if (st !== this.state || st.ended) return;
    stage.classList.remove('is-loading');
    if (!ok) {
      stage.classList.add('has-error');
      $('#image-error').hidden = false;
      if (retry) this.toast('La imagen sigue sin cargar. Revisá tu conexión.', 'error');
      return;
    }
    img.src = q.imageUrl;
    stage.style.setProperty('--bg', `url("${q.imageUrl.replace(/"/g, '%22')}")`);
    img.alt = `Imagen ${q.position}: ¿fotografía real o generada por inteligencia artificial?`;
    pulse(stage, 'enter');
    if (q.nextImageUrl) preloadImage(q.nextImageUrl);

    const total = q.total;
    $('#hud-qnum').textContent = total ? `${q.position}/${total}` : `${q.position}`;
    $('#hud-progress-fill').style.width = total ? `${((q.position - 1) / total) * 100}%` : '0%';
    $('#q-meta').textContent = `${CATEGORY_LABELS[q.category] || q.category} · ${DIFFICULTY_LABELS[q.difficulty] || ''}`;

    st.phase = 'question';
    st.busy = false;
    this._setButtons(true);

    if (st.mode === 'classic') {
      this.qTimer = new Countdown(st.perQuestionMs, {
        onTick: (rem, f) => this._setTimerDisplay(rem, f),
        onSecond: (s) => { if (s <= 5 && s > 0) sound.play(s <= 3 ? 'tickUrgent' : 'tick'); },
        onExpire: () => this.answer(null),
      }).start();
    } else {
      this.qTimer = new Stopwatch().start();
    }
  }

  /* -------------------- Respuesta -------------------- */

  /** choice: 'real' | 'ai' | null (tiempo agotado). Evita respuestas dobles. */
  async answer(choice) {
    const st = this.state;
    if (!st || st.phase !== 'question' || st.busy || st.ended) return;
    st.busy = true;
    st.phase = 'answering';
    this._setButtons(false);
    const elapsed = this.qTimer ? this.qTimer.stop() : 0;
    const q = st.current;
    $('#btn-' + (choice === 'ai' ? 'ai' : 'real')).classList.toggle('chosen', choice != null);

    let r;
    try {
      r = await this.backend.submitAnswer(st.gameId, q.questionId, choice, elapsed);
    } catch (e) {
      if (st.ended) return;
      this.toast(e.message, 'error');
      if (st.mode === 'timeattack') return this.end('time');
      // Reintento seguro: el servidor no permite responder dos veces.
      this._showRetry('No se pudo registrar tu respuesta.', async () => {
        st.phase = 'question'; st.busy = false; this.answer(choice);
      });
      return;
    }
    if (st !== this.state) return;

    st.score = r.score;
    st.streak = r.streak;
    st.bestStreak = r.bestStreak;
    st.answered += 1;
    st.history.push({ ...r, position: q.position });
    this._updateHud(r);
    this._effects(r);

    if (st.mode === 'timeattack') {
      // Devolución breve para no frenar el ritmo; el detalle se revisa al final.
      this._flash(r);
      await sleep(r.correct ? 650 : 1000);
      $$clearChosen();
      if (!st.ended) this.next();
      return;
    }
    if (st.ended) return;
    this._renderFeedback(r);
    st.phase = 'feedback';
  }

  _updateHud(r) {
    countUp($('#hud-score'), r.score);
    const s = $('#hud-streak');
    s.textContent = r.streak;
    if (r.correct) pulse(s.parentElement, 'bump');
    const st = this.state;
    if (st.total) $('#hud-progress-fill').style.width = `${(st.answered / st.total) * 100}%`;
  }

  _effects(r) {
    const stage = $('#stage');
    if (r.correct === true) {
      stage.classList.add('is-correct');
      sound.play('correct');
      floatText($('#hud-score'), `+${r.points.base}`, 'good');
      if (r.points.speed) setTimeout(() => floatText($('#hud-score'), `+${r.points.speed} rapidez`, 'speed'), 220);
      if (r.points.streak) {
        setTimeout(() => {
          floatText($('#hud-streak'), `¡Racha x${r.streak}! +${r.points.streak}`, 'streak');
          sound.play('streak');
          this._banner(`🔥 ¡Racha de ${r.streak}! +${r.points.streak} puntos`);
        }, 420);
      }
    } else if (r.correct === false) {
      stage.classList.add('is-wrong');
      sound.play('wrong');
    } else {
      stage.classList.add('is-timeout');
      sound.play('timeout');
    }
  }

  _flash(r) {
    const f = $('#answer-flash');
    f.className = 'answer-flash ' + (r.correct ? 'good' : 'bad');
    f.innerHTML = `<strong>${r.correct ? '¡Correcto!' : 'Incorrecto'}</strong><span>Era ${r.isAi ? 'GENERADA POR IA' : 'REAL'}</span>`;
    pulse(f, 'show');
  }

  _banner(text) {
    const b = $('#streak-banner');
    b.textContent = text;
    pulse(b, 'show');
  }

  /* -------------------- Devolución educativa -------------------- */

  _renderFeedback(r) {
    const q = r.question;
    const st = this.state;
    const kind = r.correct === true ? 'good' : r.correct === false ? 'bad' : 'warn';
    const verdict = { good: '¡CORRECTO!', bad: 'INCORRECTO', warn: 'TIEMPO AGOTADO' }[kind];
    const truth = r.isAi ? 'GENERADA POR IA' : 'FOTOGRAFÍA REAL';
    const sub = r.choice == null
      ? `No respondiste a tiempo · era ${r.isAi ? 'una imagen generada por IA' : 'una fotografía real'}`
      : `Respondiste ${r.choice === 'ai' ? '«Generada por IA»' : '«Real»'} en ${formatSeconds(r.elapsedMs)}`;
    const icon = {
      good: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>',
      bad: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M18 18l16 16M34 18L18 34"/></svg>',
      warn: '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M26 14v13l8 5"/></svg>',
    }[kind];
    const chips = [];
    if (r.points.base) chips.push(`<span class="chip">+${r.points.base} respuesta correcta</span>`);
    if (r.points.speed) chips.push(`<span class="chip speed">+${r.points.speed} bonus por rapidez</span>`);
    if (r.points.streak) chips.push(`<span class="chip streak">+${r.points.streak} bonus por racha de ${r.streak}</span>`);
    const list = (items) => items.map((t, i) => `<li style="--i:${i}">${escapeHtml(t)}</li>`).join('');
    const link = (url, text) => url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text);
    const prov = `<dl class="prov">
        ${r.isAi ? `<dt>Herramienta</dt><dd>${escapeHtml(q.ai_tool || 'No especificada por el autor')}</dd>` : ''}
        <dt>${r.isAi ? 'Autor / generador' : 'Autor'}</dt><dd>${escapeHtml(q.author || '—')}</dd>
        <dt>Fuente</dt><dd>${link(q.source_url, q.source)}</dd>
        <dt>Licencia</dt><dd>${link(q.license_url, q.license)}</dd>
      </dl>`;
    const tabs = [
      ['observe', '🔍', r.isAi ? 'Qué la delata' : 'Por qué es real', `<ul class="fb-list">${list(q.features)}</ul>`],
      ['tips', '💡', 'Consejos', `<ul class="fb-list">${list(q.tips)}</ul>`],
      ['context', '📍', 'Contexto', `<p>${escapeHtml(q.context)}</p>`],
      ['source', '📄', 'Procedencia documentada', prov],
    ];
    const safeImg = escapeHtml(q.image_url);
    $('#feedback-body').innerHTML = `
      <header class="fb-hero ${kind}">
        <div class="fb-icon">${icon}</div>
        <div class="fb-hero-text">
          <div class="fb-verdict">${verdict}</div>
          <div class="fb-you">${escapeHtml(sub)}</div>
        </div>
        <div class="fb-total ${r.points.total ? '' : 'zero'}">+${r.points.total}<small>puntos</small></div>
      </header>
      <div class="fb-main">
        <figure class="fb-image" style="--bg:url('${safeImg}')">
          <img src="${safeImg}" alt="${escapeHtml(q.title)}">
          <figcaption class="stamp ${r.isAi ? 'stamp-ai' : 'stamp-real'}">${truth}</figcaption>
        </figure>
        <div class="fb-summary">
          <h3>${escapeHtml(q.title)}</h3>
          <p class="fb-explanation">${escapeHtml(q.explanation)}</p>
          ${chips.length ? `<div class="fb-chips">${chips.join('')}</div>` : ''}
          ${st.mode === 'learning' ? `<p class="fb-learn">🎓 Los detalles visuales ayudan a sospechar, pero no son una prueba: lo que confirma el origen es la procedencia documentada.</p>` : ''}
        </div>
      </div>
      <nav class="fb-tabs" role="tablist" aria-label="Más información">
        ${tabs.map(([id, ico, label], i) => `<button type="button" role="tab" id="fbt-${id}" aria-controls="fbp-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span aria-hidden="true">${ico}</span> ${label}</button>`).join('')}
      </nav>
      ${tabs.map(([id, , label, html], i) => `<section class="fb-panel" role="tabpanel" id="fbp-${id}" aria-labelledby="fbt-${id}" ${i === 0 ? '' : 'hidden'}><h4 class="sr-only">${label}</h4>${html}</section>`).join('')}
    `;
    const tabBtns = [...document.querySelectorAll('.fb-tabs [role=tab]')];
    const select = (btn) => {
      for (const b of tabBtns) {
        const on = b === btn;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        document.getElementById(b.getAttribute('aria-controls')).hidden = !on;
      }
    };
    tabBtns.forEach((b, i) => {
      b.addEventListener('click', () => select(b));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const n = tabBtns[(i + (e.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length];
          select(n); n.focus();
        }
      });
    });
    const isLast = st.total && st.answered >= st.total;
    $('#btn-continue').textContent = isLast ? 'VER RESULTADOS' : 'CONTINUAR';
    const fb = $('#feedback');
    fb.hidden = false;
    fb.scrollTop = 0;
    music.duck(true);
    requestAnimationFrame(() => fb.classList.add('open'));
    setTimeout(() => $('#btn-continue').focus({ preventScroll: true }), 50);
  }

  continue() {
    const st = this.state;
    if (!st || st.phase !== 'feedback') return;
    st.phase = 'loading';
    sound.play('click');
    this._closeFeedback();
    $$clearChosen();
    this.next();
  }

  _closeFeedback() {
    const fb = $('#feedback');
    fb.classList.remove('open');
    music.duck(false);
    fb.hidden = true;
  }

  /* -------------------- Final -------------------- */

  async end(reason) {
    const st = this.state;
    if (!st || st.ended) return;
    st.ended = true;
    st.phase = 'ended';
    this._setButtons(false);
    this.qTimer?.stop?.();
    this.gameTimer?.stop();
    this._closeFeedback();
    if (st.mode === 'timeattack' && reason === 'time') this._setTimerDisplay(0, 0);
    let summary;
    try {
      summary = await this.backend.finishGame(st.gameId);
    } catch (e) {
      this.toast(e.message, 'error');
      summary = null;
    }
    sound.play('finish');
    this.onFinish(summary, { mode: st.mode, difficulty: st.difficulty, name: st.name, history: st.history, reason });
  }

  quit() {
    if (!this.state || this.state.ended) return;
    if (!confirm('¿Abandonar la partida? No se guardará el resultado.')) return;
    this.state.ended = true;
    this._cleanup();
    this.show('home');
  }

  _cleanup() {
    this.qTimer?.stop?.();
    this.gameTimer?.stop();
    this._closeFeedback?.();
    $('#retry-box').hidden = true;
    this.state = null;
  }

  /* -------------------- Utilidades de UI -------------------- */

  _setButtons(enabled) {
    for (const b of [$('#btn-real'), $('#btn-ai')]) b.disabled = !enabled;
  }

  _setTimerDisplay(remMs, fraction) {
    // El suspenso crece a medida que se acaba el tiempo
    if (remMs != null) music.setIntensity(remMs <= 5000 ? 1 : 0.15 + (1 - fraction) * 0.4);
    else music.setIntensity(0);
    const txt = $('#hud-timer-text');
    const ring = $('#hud-timer-ring');
    const bar = $('#hud-timebar-fill');
    if (remMs == null) {
      txt.textContent = '∞';
      ring.style.strokeDashoffset = 0;
      bar.style.width = '100%';
      $('#hud-timer').classList.remove('urgent');
      return;
    }
    const secs = Math.ceil(remMs / 1000);
    txt.textContent = secs;
    const C = 2 * Math.PI * 26;
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - fraction);
    bar.style.width = `${fraction * 100}%`;
    $('#hud-timer').classList.toggle('urgent', secs <= 5);
  }

  _showRetry(message, fn) {
    const box = $('#retry-box');
    $('#retry-text').textContent = message;
    box.hidden = false;
    const btn = $('#btn-retry');
    const clone = btn.cloneNode(true);
    btn.replaceWith(clone);
    clone.addEventListener('click', () => { box.hidden = true; fn(); });
  }
}

function $$clearChosen() {
  document.querySelectorAll('.answer-btn.chosen').forEach((b) => b.classList.remove('chosen'));
}

/* ======================================================================
 *  Pantalla de resultados
 * ====================================================================== */

export function renderResults(summary, ctx) {
  const box = $('#results-body');
  if (!summary) {
    box.innerHTML = `<p class="error-box">No se pudo guardar el resultado de la partida. Revisá tu conexión e intentá de nuevo.</p>`;
    return;
  }
  const rate = rating(summary.correct, summary.total || 10);
  const scopeTxt = summary.scope === 'global' ? 'ranking global' : 'ranking local de este dispositivo';
  let rankLine = '';
  if (!summary.ranked) rankLine = '<p class="muted">El modo aprendizaje no suma al ranking competitivo.</p>';
  else if (summary.flagged) rankLine = '<p class="warn-box">La partida quedó en revisión y no aparece en el ranking.</p>';
  else if (summary.rank) rankLine = `<p class="rank-line">Tu mejor resultado está en el puesto <strong>#${summary.rank}</strong> del ${scopeTxt} (${MODE_LABELS[ctx.mode]}).</p>`;
  const stats = [
    ['Puntaje total', summary.score.toLocaleString('es-AR'), 'big'],
    ['Respuestas correctas', summary.correct],
    ['Respuestas incorrectas', summary.wrong],
    ['Sin responder', summary.unanswered],
    ['Porcentaje de aciertos', formatPercent(summary.accuracy)],
    ['Tiempo promedio', formatSeconds(summary.avgMs)],
    ['Mejor racha', summary.bestStreak],
    ['Duración de la partida', formatDuration(summary.durationMs)],
  ];
  box.innerHTML = `
    <div class="result-head level-${rate.level}">
      <p class="result-player">${escapeHtml(ctx.name)} · ${escapeHtml(MODE_LABELS[ctx.mode])} · ${escapeHtml(DIFFICULTY_LABELS[ctx.difficulty] || '')}</p>
      <h2 class="result-rating">${escapeHtml(rate.text)}</h2>
      <p class="result-sub">${summary.correct} de ${summary.total} imágenes identificadas correctamente</p>
    </div>
    <div class="result-stats">
      ${stats.map(([k, v, c]) => `<div class="stat ${c || ''}"><span class="stat-v">${escapeHtml(String(v))}</span><span class="stat-k">${escapeHtml(k)}</span></div>`).join('')}
    </div>
    ${rankLine}
    <details class="review" ${ctx.mode === 'timeattack' ? 'open' : ''}>
      <summary>Revisar las imágenes de la partida (${ctx.history.length})</summary>
      <ol class="review-list">
        ${ctx.history.map((h) => `
          <li class="${h.correct === true ? 'good' : h.correct === false ? 'bad' : 'warn'}">
            <img src="${escapeHtml(h.question.image_url)}" alt="" loading="lazy">
            <div>
              <strong>${escapeHtml(h.question.title)}</strong>
              <span>${h.isAi ? 'Generada por IA' : 'Fotografía real'} · ${h.correct === true ? 'Acertaste' : h.correct === false ? 'Fallaste' : 'Sin responder'} · +${h.points.total}</span>
              <p>${escapeHtml(h.question.explanation)}</p>
            </div>
          </li>`).join('')}
      </ol>
    </details>
  `;
  const intensity = summary.accuracy >= 0.9 ? 1.4 : summary.accuracy >= 0.7 ? 1 : 0.4;
  setTimeout(() => confetti(intensity), 250);
}

export { RULES };
