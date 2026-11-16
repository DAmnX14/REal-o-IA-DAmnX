/**
 * scoring.js — Reglas de puntuación (fuente única en el frontend).
 * Las MISMAS reglas están implementadas en SQL (supabase/schema.sql → submit_answer)
 * para que el servidor calcule los puntos oficiales del ranking global.
 */

export const RULES = Object.freeze({
  BASE_POINTS: 100,            // respuesta correcta
  SPEED_BONUS: 50,             // correcta con más de 10 s restantes (modo clásico)
  CLASSIC_TIME_MS: 15000,      // 15 s por imagen
  SPEED_THRESHOLD_MS: 5000,    // >10 s restantes  ⇔  respondida en menos de 5 s
  STREAK_BONUSES: Object.freeze({ 3: 50, 5: 100 }), // al alcanzar 3 y 5 aciertos seguidos
  TIMEATTACK_MS: 60000,        // 60 s de juego en contrarreloj
  CLASSIC_QUESTIONS: 10,
  LEARNING_QUESTIONS: 10,
});

/**
 * Calcula los puntos de una respuesta.
 * @param {object} p
 * @param {boolean|null} p.correct  true/false; null = no respondida (tiempo agotado)
 * @param {number} p.elapsedMs      tiempo que tardó en responder
 * @param {number} p.streakBefore   racha de aciertos antes de esta respuesta
 * @param {'classic'|'timeattack'|'learning'} p.mode
 */
export function scoreAnswer({ correct, elapsedMs, streakBefore, mode }) {
  if (correct !== true) {
    return { base: 0, speed: 0, streak: 0, total: 0, newStreak: 0 };
  }
  const base = RULES.BASE_POINTS;
  const speed = mode === 'classic' && elapsedMs < RULES.SPEED_THRESHOLD_MS ? RULES.SPEED_BONUS : 0;
  const newStreak = (streakBefore || 0) + 1;
  const streak = RULES.STREAK_BONUSES[newStreak] || 0;
  return { base, speed, streak, total: base + speed + streak, newStreak };
}

/**
 * Resume una lista de respuestas.
 * answers: [{ correct: true|false|null, elapsedMs, points }]
 */
export function summarize(answers, { startedAt, finishedAt } = {}) {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct === true).length;
  const wrong = answers.filter((a) => a.correct === false).length;
  const unanswered = answers.filter((a) => a.correct == null).length;
  const answered = answers.filter((a) => a.correct != null);
  const avgMs = answered.length ? Math.round(answered.reduce((s, a) => s + a.elapsedMs, 0) / answered.length) : null;
  let best = 0, cur = 0;
  for (const a of answers) { cur = a.correct === true ? cur + 1 : 0; best = Math.max(best, cur); }
  return {
    total, correct, wrong, unanswered,
    score: answers.reduce((s, a) => s + (a.points?.total || 0), 0),
    accuracy: total ? correct / total : 0,
    avgMs,
    bestStreak: best,
    durationMs: startedAt != null && finishedAt != null ? finishedAt - startedAt : null,
  };
}

/** Calificación final según cantidad de aciertos (escala de 10 preguntas). */
export function rating(correct, total = 10) {
  const c = total === 10 ? correct : Math.round((correct / Math.max(total, 1)) * 10);
  if (c <= 3) return { level: 1, text: '¡Todavía hay mucho por descubrir!' };
  if (c <= 6) return { level: 2, text: '¡Vas por buen camino!' };
  if (c <= 8) return { level: 3, text: '¡Tenés muy buen ojo!' };
  return { level: 4, text: '¡Experto en detectar IA!' };
}

/** Comparador oficial del ranking: puntaje ↓, % aciertos ↓, tiempo promedio ↑. */
export function compareRanking(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  return (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity);
}
