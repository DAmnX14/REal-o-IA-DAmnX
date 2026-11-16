/**
 * selection.js — Selección aleatoria y equilibrada de preguntas.
 *
 * Garantías:
 *  - Sin repetidas dentro de una partida.
 *  - Mitad REAL / mitad IA (cuando el banco lo permite).
 *  - Categorías repartidas (round-robin por categoría dentro de cada clase).
 *  - Se priorizan imágenes que el dispositivo no vio recientemente.
 *  - Orden final mezclado evitando: misma categoría consecutiva y más de 2
 *    respuestas correctas iguales seguidas (p.ej. REAL, REAL, REAL).
 *
 * La misma lógica está replicada en SQL (supabase/schema.sql → _pick_questions)
 * para el modo en línea.
 */
import { shuffle, randInt } from './utils.js';

/** Elige n elementos de `items` repartiendo categorías y priorizando no vistos. */
function pickSpread(items, n, recent = new Set()) {
  const fresh = shuffle(items.filter((q) => !recent.has(q.id)));
  const seen = shuffle(items.filter((q) => recent.has(q.id)));
  const ordered = [...fresh, ...seen]; // primero las no vistas
  const byCat = new Map();
  for (const q of ordered) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category).push(q);
  }
  // Las categorías con preguntas "frescas" primero, el resto en orden aleatorio.
  const cats = shuffle([...byCat.keys()]).sort((a, b) => {
    const fa = recent.has(byCat.get(a)[0].id) ? 1 : 0;
    const fb = recent.has(byCat.get(b)[0].id) ? 1 : 0;
    return fa - fb;
  });
  const out = [];
  while (out.length < n && cats.some((c) => byCat.get(c).length)) {
    for (const c of cats) {
      const list = byCat.get(c);
      if (list.length && out.length < n) out.push(list.shift());
    }
  }
  return out;
}

/** ¿El orden cumple las restricciones de alternancia? */
function orderScore(list) {
  let penalty = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].category === list[i - 1].category) penalty += 1;
    if (i >= 2 && list[i].is_ai === list[i - 1].is_ai && list[i].is_ai === list[i - 2].is_ai) penalty += 2;
  }
  return penalty;
}

/** Mezcla buscando un orden sin penalizaciones (hasta 300 intentos). */
export function arrangeOrder(list) {
  let best = shuffle(list), bestScore = orderScore(best);
  for (let i = 0; i < 300 && bestScore > 0; i++) {
    const cand = shuffle(list);
    const s = orderScore(cand);
    if (s < bestScore) { best = cand; bestScore = s; }
  }
  return best;
}

/**
 * Selecciona `count` preguntas equilibradas.
 * @param {Array} bank        preguntas activas
 * @param {object} opts
 * @param {number} opts.count
 * @param {'mixed'|'easy'|'medium'|'hard'} opts.difficulty
 * @param {string[]} opts.recent  ids vistos recientemente
 */
export function selectQuestions(bank, { count = 10, difficulty = 'mixed', recent = [] } = {}) {
  const recentSet = new Set(recent);
  let pool = bank.filter((q) => q.active !== false && (difficulty === 'mixed' || q.difficulty === difficulty));
  if (pool.length < count) pool = bank.filter((q) => q.active !== false); // el banco filtrado no alcanza
  const ai = pool.filter((q) => q.is_ai);
  const real = pool.filter((q) => !q.is_ai);
  let nAi = Math.floor(count / 2);
  if (count % 2 === 1 && randInt(2)) nAi += 1;
  let nReal = count - nAi;
  if (ai.length < nAi) { nReal += nAi - ai.length; nAi = ai.length; }
  if (real.length < nReal) { nAi += nReal - real.length; nReal = real.length; }
  const chosen = [...pickSpread(ai, nAi, recentSet), ...pickSpread(real, nReal, recentSet)];
  return arrangeOrder(chosen).slice(0, count);
}

/** Orden completo para el modo contrarreloj: todo el banco, alternado y sin repetir. */
export function timeAttackSequence(bank, { difficulty = 'mixed', recent = [] } = {}) {
  let pool = bank.filter((q) => q.active !== false && (difficulty === 'mixed' || q.difficulty === difficulty));
  if (pool.length < 10) pool = bank.filter((q) => q.active !== false);
  return selectQuestions(pool, { count: pool.length, difficulty: 'mixed', recent });
}
