/**
 * database.js — Capa de datos del juego.
 *
 * Expone una misma interfaz con dos implementaciones:
 *
 *  • SupabaseBackend (modo EN LÍNEA): el servidor elige las preguntas, toma los tiempos,
 *    corrige las respuestas y calcula los puntos mediante funciones SQL seguras
 *    (SECURITY DEFINER). El navegador nunca recibe la respuesta correcta antes de responder
 *    y no puede escribir puntajes directamente → ranking global protegido contra manipulación.
 *
 *  • LocalBackend (modo SIN CONEXIÓN): se usa automáticamente si Supabase no está
 *    configurado o no responde. Usa data/questions.json y guarda un ranking LOCAL del
 *    dispositivo, que la interfaz identifica claramente como tal.
 *
 * Interfaz común (todas async):
 *   init() · startGame({name, mode, difficulty}) · nextQuestion(gameId)
 *   submitAnswer(gameId, questionId, choice, clientElapsedMs) · finishGame(gameId)
 *   getRanking({mode, search, page, pageSize}) · getStats() · getCredits()
 */
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { RULES, scoreAnswer, summarize, compareRanking } from './scoring.js';
import { selectQuestions, timeAttackSequence } from './selection.js';
import { resolveImageUrl, uuid, validateName, SITE_ROOT } from './utils.js';

export class GameError extends Error {}

/* ======================================================================
 *  Banco de imágenes local (data/questions.json)
 * ====================================================================== */

const REQUIRED_FIELDS = ['id', 'file', 'classification', 'category', 'difficulty', 'title', 'context',
  'explanation', 'features', 'tips', 'source', 'license', 'added_at'];

let bankPromise = null;

/** Carga y valida el banco local. Devuelve { questions, report }. */
export function loadLocalBank({ checkImages = true } = {}) {
  if (!bankPromise) {
    bankPromise = (async () => {
      const res = await fetch(new URL('data/questions.json', SITE_ROOT), { cache: 'no-cache' });
      if (!res.ok) throw new GameError('No se pudo cargar el banco de imágenes (data/questions.json).');
      const data = await res.json();
      const raw = data.questions || [];
      const problems = [];
      const ids = new Set();
      const questions = [];
      for (const q of raw) {
        const missing = REQUIRED_FIELDS.filter((f) => q[f] == null || q[f] === '');
        if (missing.length) { problems.push(`${q.id || '?'}: faltan campos ${missing.join(', ')}`); continue; }
        if (ids.has(q.id)) { problems.push(`${q.id}: ID duplicado`); continue; }
        if (!['REAL', 'IA'].includes(q.classification)) { problems.push(`${q.id}: clasificación inválida`); continue; }
        ids.add(q.id);
        questions.push({ ...q, is_ai: q.classification === 'IA', image_url: q.file, active: q.active !== false });
      }
      // Verificación de existencia de cada archivo de imagen antes de habilitar el juego.
      if (checkImages) {
        const checks = await Promise.all(questions.map(async (q) => {
          try {
            const r = await fetch(resolveImageUrl(q.file), { method: 'HEAD', cache: 'no-cache' });
            return r.ok;
          } catch { return false; }
        }));
        checks.forEach((ok, i) => {
          if (!ok) { problems.push(`${questions[i].id}: no se encontró la imagen ${questions[i].file}`); questions[i].active = false; }
        });
      }
      const active = questions.filter((q) => q.active);
      const report = {
        total: raw.length,
        valid: active.length,
        real: active.filter((q) => !q.is_ai).length,
        ai: active.filter((q) => q.is_ai).length,
        problems,
        playable: active.filter((q) => !q.is_ai).length >= 5 && active.filter((q) => q.is_ai).length >= 5,
      };
      if (problems.length) console.warn('[REAL OR AI] Problemas en el banco de imágenes:', problems);
      return { questions, report, meta: data.meta || {} };
    })();
    bankPromise.catch(() => { bankPromise = null; });
  }
  return bankPromise;
}

/** Datos públicos de una pregunta para mostrar después de responder. */
function publicDetails(q) {
  return {
    id: q.id, title: q.title, context: q.context, explanation: q.explanation,
    features: q.features || [], tips: q.tips || [], category: q.category, difficulty: q.difficulty,
    source: q.source, source_url: q.source_url, author: q.author, license: q.license,
    license_url: q.license_url, ai_tool: q.ai_tool, image_url: resolveImageUrl(q.image_url || q.file),
  };
}

/* ======================================================================
 *  LocalBackend
 * ====================================================================== */

class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.games = new Map();
  }

  async init() {
    const { report } = await loadLocalBank();
    this.report = report;
    return report;
  }

  async _bank() { return (await loadLocalBank()).questions.filter((q) => q.active); }

  async startGame({ name, mode, difficulty }) {
    const v = validateName(name);
    if (!v.ok) throw new GameError(v.error);
    if (!['classic', 'timeattack', 'learning'].includes(mode)) throw new GameError('Modo de juego inválido.');
    const bank = await this._bank();
    const recent = storage.recentQuestions();
    const list = mode === 'timeattack'
      ? timeAttackSequence(bank, { difficulty, recent })
      : selectQuestions(bank, { count: mode === 'learning' ? RULES.LEARNING_QUESTIONS : RULES.CLASSIC_QUESTIONS, difficulty, recent });
    if (list.length < 2) throw new GameError('No hay suficientes imágenes disponibles para jugar.');
    const game = {
      id: uuid(), name: v.value, mode, difficulty, startedAt: Date.now(), finishedAt: null,
      questions: list, position: 0, pending: null, answers: [], streak: 0, bestStreak: 0, score: 0, finished: false,
    };
    this.games.set(game.id, game);
    return {
      gameId: game.id, mode, difficulty,
      total: mode === 'timeattack' ? null : list.length,
      perQuestionMs: mode === 'classic' ? RULES.CLASSIC_TIME_MS : null,
      gameTimeMs: mode === 'timeattack' ? RULES.TIMEATTACK_MS : null,
    };
  }

  _game(id) {
    const g = this.games.get(id);
    if (!g) throw new GameError('Partida no encontrada.');
    if (g.finished) throw new GameError('La partida ya terminó.');
    return g;
  }

  _timeOver(g) { return g.mode === 'timeattack' && Date.now() - g.startedAt >= RULES.TIMEATTACK_MS; }

  async nextQuestion(gameId) {
    const g = this._game(gameId);
    if (this._timeOver(g)) return { done: true, reason: 'time' };
    if (!g.pending) {
      if (g.position >= g.questions.length) return { done: true, reason: 'end' };
      g.pending = { q: g.questions[g.position], servedAt: Date.now() };
      g.position += 1;
    }
    const q = g.pending.q;
    return {
      done: false, questionId: q.id, imageUrl: resolveImageUrl(q.image_url), position: g.position,
      total: g.mode === 'timeattack' ? null : g.questions.length, category: q.category, difficulty: q.difficulty,
      nextImageUrl: g.questions[g.position] ? resolveImageUrl(g.questions[g.position].image_url) : null,
    };
  }

  async submitAnswer(gameId, questionId, choice, clientElapsedMs) {
    const g = this._game(gameId);
    if (!g.pending || g.pending.q.id !== questionId) throw new GameError('Esta pregunta ya fue respondida.');
    if (choice != null && !['real', 'ai'].includes(choice)) throw new GameError('Respuesta inválida.');
    if (this._timeOver(g) && Date.now() - g.startedAt > RULES.TIMEATTACK_MS + 1500) {
      g.pending = null;
      throw new GameError('Se terminó el tiempo de la partida.');
    }
    const q = g.pending.q;
    const elapsedMs = Math.max(0, Math.round(clientElapsedMs ?? Date.now() - g.pending.servedAt));
    let effectiveChoice = choice;
    if (g.mode === 'classic' && elapsedMs > RULES.CLASSIC_TIME_MS) effectiveChoice = null;
    const correct = effectiveChoice == null ? null : (effectiveChoice === 'ai') === q.is_ai;
    const points = scoreAnswer({ correct, elapsedMs, streakBefore: g.streak, mode: g.mode });
    g.streak = points.newStreak;
    g.bestStreak = Math.max(g.bestStreak, g.streak);
    g.score += points.total;
    g.answers.push({ questionId: q.id, isAi: q.is_ai, choice: effectiveChoice, correct, elapsedMs, points, category: q.category, difficulty: q.difficulty });
    g.pending = null;
    return {
      correct, isAi: q.is_ai, choice: effectiveChoice, points, score: g.score, streak: g.streak,
      bestStreak: g.bestStreak, elapsedMs, question: publicDetails(q),
    };
  }

  async finishGame(gameId) {
    const g = this._game(gameId);
    g.pending = null; // en contrarreloj, la imagen en pantalla al terminar el tiempo no cuenta
    g.finished = true;
    g.finishedAt = Date.now();
    if (g.mode === 'classic' && g.answers.length < g.questions.length) throw new GameError('La partida no se completó.');
    const s = summarize(g.answers, { startedAt: g.startedAt, finishedAt: g.finishedAt });
    storage.pushRecentQuestions(g.answers.map((a) => a.questionId));
    // Historial local de respuestas (estadísticas del dispositivo)
    const hist = storage.read('localAnswers', []);
    const now = new Date().toISOString();
    for (const a of g.answers) hist.push({ q: a.questionId, ai: a.isAi, c: a.correct, ms: a.elapsedMs, d: now, m: g.mode, cat: a.category });
    storage.write('localAnswers', hist.slice(-3000));
    const result = {
      id: g.id, name: g.name, mode: g.mode, difficulty: g.difficulty, score: s.score, correct: s.correct,
      wrong: s.wrong, unanswered: s.unanswered, total: s.total, accuracy: s.accuracy, avgMs: s.avgMs,
      bestStreak: s.bestStreak, durationMs: s.durationMs, date: now,
    };
    let rank = null;
    if (g.mode !== 'learning') {
      const results = storage.read('localResults', []);
      results.push(result);
      storage.write('localResults', results.slice(-500));
      const board = this._board(g.mode);
      rank = board.findIndex((r) => r.id === g.id) + 1 || null;
    } else {
      const learning = storage.read('localLearning', 0);
      storage.write('localLearning', learning + 1);
    }
    return { ...s, rank, ranked: g.mode !== 'learning', scope: 'local', name: g.name, mode: g.mode };
  }

  /** Mejor partida por jugador (nombre) y modo, ordenada con desempates oficiales. */
  _board(mode) {
    const results = storage.read('localResults', []).filter((r) => r.mode === mode);
    const best = new Map();
    for (const r of results) {
      const key = r.name.toLowerCase();
      if (!best.has(key) || compareRanking(r, best.get(key)) < 0) best.set(key, r);
    }
    return [...best.values()].sort(compareRanking);
  }

  async getRanking({ mode = 'classic', search = '', page = 1, pageSize = 10 } = {}) {
    let rows = this._board(mode).map((r, i) => ({ position: i + 1, name: r.name, score: r.score, accuracy: r.accuracy, avgMs: r.avgMs, date: r.date }));
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((r) => r.name.toLowerCase().includes(s));
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, scope: 'local' };
  }

  async getStats() {
    const { questions } = await loadLocalBank({ checkImages: false });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const results = storage.read('localResults', []);
    const answers = storage.read('localAnswers', []);
    return buildStats({
      games: results.map((r) => ({ score: r.score, mode: r.mode, date: r.date, name: r.name })),
      learningGames: storage.read('localLearning', 0),
      answers: answers.map((a) => ({ questionId: a.q, isAi: a.ai, correct: a.c, date: a.d, category: a.cat })),
      questionsById: byId,
      scope: 'local',
    });
  }

  async getCredits() {
    const { questions } = await loadLocalBank({ checkImages: false });
    return questions.map((q) => ({ id: q.id, title: q.title, source: q.source, source_url: q.source_url, author: q.author, license: q.license, license_url: q.license_url }));
  }
}

/** Calcula estadísticas agregadas a partir de partidas y respuestas (usado en modo local). */
export function buildStats({ games, learningGames = 0, answers, questionsById, scope }) {
  const ranked = games.filter((g) => g.mode !== 'learning');
  const answered = answers;
  const correct = answered.filter((a) => a.correct === true).length;
  const aiAns = answered.filter((a) => a.isAi);
  const realAns = answered.filter((a) => !a.isAi);
  const perQ = new Map();
  for (const a of answered) {
    if (!perQ.has(a.questionId)) perQ.set(a.questionId, { n: 0, wrong: 0, saidReal: 0, saidAi: 0 });
    const s = perQ.get(a.questionId);
    s.n++; if (a.correct !== true) s.wrong++;
  }
  const hardest = [...perQ.entries()]
    .filter(([id, s]) => s.n >= 1 && questionsById.get(id))
    .map(([id, s]) => {
      const q = questionsById.get(id);
      return { id, title: q.title, image_url: resolveImageUrl(q.image_url || q.file), is_ai: q.is_ai, answers: s.n, errorRate: s.wrong / s.n };
    })
    .sort((a, b) => b.errorRate - a.errorRate || b.answers - a.answers)
    .slice(0, 8);
  const days = new Map();
  for (const g of games) {
    const d = (g.date || '').slice(0, 10);
    if (d) days.set(d, (days.get(d) || 0) + 1);
  }
  const timeline = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, count]) => ({ date, count }));
  const cat = new Map();
  for (const a of answered) {
    if (!a.category) continue;
    if (!cat.has(a.category)) cat.set(a.category, { n: 0, c: 0 });
    const s = cat.get(a.category); s.n++; if (a.correct === true) s.c++;
  }
  return {
    scope,
    totalGames: games.length + (learningGames || 0),
    rankedGames: ranked.length,
    totalPlayers: new Set(games.map((g) => (g.name || '').toLowerCase())).size,
    avgScoreClassic: avg(games.filter((g) => g.mode === 'classic').map((g) => g.score)),
    accuracy: answered.length ? correct / answered.length : null,
    aiAccuracy: aiAns.length ? aiAns.filter((a) => a.correct === true).length / aiAns.length : null,
    realAccuracy: realAns.length ? realAns.filter((a) => a.correct === true).length / realAns.length : null,
    distribution: {
      aiCorrect: aiAns.filter((a) => a.correct === true).length,
      aiWrong: aiAns.filter((a) => a.correct === false).length,
      realCorrect: realAns.filter((a) => a.correct === true).length,
      realWrong: realAns.filter((a) => a.correct === false).length,
      unanswered: answered.filter((a) => a.correct == null).length,
    },
    categories: [...cat.entries()].map(([category, s]) => ({ category, accuracy: s.c / s.n, answers: s.n })).sort((a, b) => a.accuracy - b.accuracy),
    hardest,
    timeline,
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

/* ======================================================================
 *  SupabaseBackend
 * ====================================================================== */

let supabaseLibPromise = null;

/** Carga la librería oficial supabase-js (copia local en js/vendor, sin CDN). */
export function loadSupabaseLib() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (!supabaseLibPromise) {
    supabaseLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('js/vendor/supabase.js', SITE_ROOT).href;
      s.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('supabase-js no disponible')));
      s.onerror = () => reject(new Error('No se pudo cargar supabase-js'));
      document.head.append(s);
    });
  }
  return supabaseLibPromise;
}

export function isSupabaseConfigured() {
  // https obligatorio; http solo para pruebas locales (Supabase CLI / PostgREST en localhost)
  return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(CONFIG.SUPABASE_URL));
}

let clientPromise = null;
export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = loadSupabaseLib().then((lib) => lib.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    }));
  }
  return clientPromise;
}

class SupabaseBackend {
  constructor() { this.kind = 'online'; }

  async init() {
    this.sb = await getSupabaseClient();
    // Comprobación rápida de conectividad y del banco publicado.
    const info = await this._rpc('get_bank_info', {});
    this.report = { total: info.total, valid: info.active, real: info.real, ai: info.ai, problems: [], playable: info.real >= 5 && info.ai >= 5 };
    return this.report;
  }

  async _rpc(fn, params) {
    const { data, error } = await this.sb.rpc(fn, params);
    if (error) {
      const msg = error.message || 'Error de comunicación con el servidor.';
      throw new GameError(/fetch|network/i.test(msg) ? 'No hay conexión con el servidor.' : msg);
    }
    return data;
  }

  async startGame({ name, mode, difficulty }) {
    const v = validateName(name);
    if (!v.ok) throw new GameError(v.error);
    const r = await this._rpc('start_game', { p_device: storage.deviceId(), p_name: v.value, p_mode: mode, p_difficulty: difficulty });
    return {
      gameId: r.game_id, mode: r.mode, difficulty: r.difficulty, total: r.total,
      perQuestionMs: r.per_question_ms, gameTimeMs: r.game_time_ms,
    };
  }

  async nextQuestion(gameId) {
    const r = await this._rpc('next_question', { p_game: gameId, p_device: storage.deviceId() });
    if (r.done) return { done: true, reason: r.reason };
    return {
      done: false, questionId: r.question_id, imageUrl: resolveImageUrl(r.image_url), position: r.position,
      total: r.total, category: r.category, difficulty: r.difficulty,
    };
  }

  async submitAnswer(gameId, questionId, choice, clientElapsedMs) {
    const r = await this._rpc('submit_answer', {
      p_game: gameId, p_device: storage.deviceId(), p_question: questionId, p_choice: choice,
      p_client_ms: Math.round(clientElapsedMs ?? 0),
    });
    const q = r.question;
    return {
      correct: r.correct, isAi: r.is_ai, choice: r.choice,
      points: { base: r.points_base, speed: r.points_speed, streak: r.points_streak, total: r.points_total },
      score: r.score, streak: r.streak, bestStreak: r.best_streak, elapsedMs: r.elapsed_ms,
      question: { ...q, image_url: resolveImageUrl(q.image_url) },
    };
  }

  async finishGame(gameId) {
    const r = await this._rpc('finish_game', { p_game: gameId, p_device: storage.deviceId() });
    return {
      score: r.score, correct: r.correct, wrong: r.wrong, unanswered: r.unanswered, total: r.total,
      accuracy: r.accuracy, avgMs: r.avg_ms, bestStreak: r.best_streak, durationMs: r.duration_ms,
      rank: r.rank, ranked: r.ranked, flagged: r.flagged, scope: 'global', name: r.name, mode: r.mode,
    };
  }

  async getRanking({ mode = 'classic', search = '', page = 1, pageSize = 10 } = {}) {
    const r = await this._rpc('get_ranking', { p_mode: mode, p_search: search || null, p_limit: pageSize, p_offset: (page - 1) * pageSize });
    return {
      total: r.total, scope: 'global',
      rows: (r.rows || []).map((x) => ({ position: x.position, name: x.name, score: x.score, accuracy: Number(x.accuracy), avgMs: x.avg_ms, date: x.date })),
    };
  }

  async getStats() {
    const r = await this._rpc('get_public_stats', {});
    return {
      scope: 'global',
      totalGames: r.total_games, rankedGames: r.ranked_games, totalPlayers: r.total_players,
      avgScoreClassic: r.avg_score_classic, accuracy: r.accuracy, aiAccuracy: r.ai_accuracy, realAccuracy: r.real_accuracy,
      distribution: r.distribution,
      categories: r.categories || [],
      hardest: (r.hardest || []).map((h) => ({ ...h, image_url: resolveImageUrl(h.image_url), errorRate: Number(h.error_rate) })),
      timeline: r.timeline || [],
    };
  }

  async getCredits() { return this._rpc('get_credits', {}); }
}

/* ======================================================================
 *  Selección automática del backend
 * ====================================================================== */

let backendPromise = null;

/** Devuelve el backend activo: Supabase si está configurado y responde; si no, el local. */
export function getBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (isSupabaseConfigured()) {
        try {
          const b = new SupabaseBackend();
          await b.init();
          return b;
        } catch (e) {
          console.warn('[REAL OR AI] Supabase no disponible, se usa el modo local:', e);
          if (!CONFIG.OFFLINE_FALLBACK) throw new GameError('No se pudo conectar con el servidor del juego. Intentá más tarde.');
        }
      }
      const b = new LocalBackend();
      await b.init();
      return b;
    })();
    backendPromise.catch(() => { backendPromise = null; });
  }
  return backendPromise;
}
