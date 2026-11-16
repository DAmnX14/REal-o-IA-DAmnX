/**
 * Pruebas unitarias (node --test) de la lógica pura: puntuación, selección y validación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES, scoreAnswer, summarize, rating, compareRanking } from '../js/scoring.js';
import { selectQuestions, timeAttackSequence } from '../js/selection.js';
import { validateName, escapeHtml } from '../js/utils.js';

const bank = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url)))
  .questions.map((q) => ({ ...q, is_ai: q.classification === 'IA', active: true }));

test('puntos: correcta rápida, lenta, incorrecta y sin responder', () => {
  assert.deepEqual(scoreAnswer({ correct: true, elapsedMs: 3000, streakBefore: 0, mode: 'classic' }), { base: 100, speed: 50, streak: 0, total: 150, newStreak: 1 });
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 5000, streakBefore: 0, mode: 'classic' }).speed, 0, '5 s exactos = 10 s restantes, no "más de 10"');
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 4999, streakBefore: 0, mode: 'classic' }).speed, 50);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 1000, streakBefore: 0, mode: 'timeattack' }).speed, 0, 'sin bonus de rapidez fuera del clásico');
  assert.deepEqual(scoreAnswer({ correct: false, elapsedMs: 1000, streakBefore: 4, mode: 'classic' }), { base: 0, speed: 0, streak: 0, total: 0, newStreak: 0 });
  assert.equal(scoreAnswer({ correct: null, elapsedMs: 15000, streakBefore: 2, mode: 'classic' }).newStreak, 0);
});

test('bonus de racha en 3 y 5 aciertos', () => {
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 9000, streakBefore: 2, mode: 'classic' }).streak, 50);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 9000, streakBefore: 4, mode: 'classic' }).streak, 100);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 9000, streakBefore: 5, mode: 'classic' }).streak, 0);
});

test('partida perfecta = 1650 puntos y resumen correcto', () => {
  let streak = 0; const answers = [];
  for (let i = 0; i < 10; i++) {
    const p = scoreAnswer({ correct: true, elapsedMs: 2000, streakBefore: streak, mode: 'classic' });
    streak = p.newStreak; answers.push({ correct: true, elapsedMs: 2000, points: p });
  }
  const s = summarize(answers, { startedAt: 0, finishedAt: 60000 });
  assert.equal(s.score, 1650);
  assert.equal(s.accuracy, 1);
  assert.equal(s.bestStreak, 10);
  assert.equal(s.avgMs, 2000);
  assert.equal(s.durationMs, 60000);
});

test('calificaciones por cantidad de aciertos', () => {
  assert.equal(rating(0).text, '¡Todavía hay mucho por descubrir!');
  assert.equal(rating(3).text, '¡Todavía hay mucho por descubrir!');
  assert.equal(rating(4).text, '¡Vas por buen camino!');
  assert.equal(rating(6).text, '¡Vas por buen camino!');
  assert.equal(rating(7).text, '¡Tenés muy buen ojo!');
  assert.equal(rating(8).text, '¡Tenés muy buen ojo!');
  assert.equal(rating(9).text, '¡Experto en detectar IA!');
  assert.equal(rating(10).text, '¡Experto en detectar IA!');
});

test('desempates del ranking', () => {
  const rows = [
    { name: 'a', score: 900, accuracy: 0.8, avgMs: 4000 },
    { name: 'b', score: 900, accuracy: 0.9, avgMs: 6000 },
    { name: 'c', score: 900, accuracy: 0.9, avgMs: 3000 },
    { name: 'd', score: 1200, accuracy: 0.7, avgMs: 9000 },
  ].sort(compareRanking);
  assert.deepEqual(rows.map((r) => r.name), ['d', 'c', 'b', 'a']);
});

test('selección: 10 sin repetir, 5 REAL + 5 IA, sin categorías consecutivas, y variada', () => {
  const sequences = new Set();
  for (let k = 0; k < 300; k++) {
    for (const difficulty of ['mixed', 'easy', 'medium', 'hard']) {
      const sel = selectQuestions(bank, { count: 10, difficulty });
      assert.equal(sel.length, 10);
      assert.equal(new Set(sel.map((q) => q.id)).size, 10, 'sin repetidas');
      assert.equal(sel.filter((q) => q.is_ai).length, 5, 'equilibrio REAL/IA');
      if (difficulty !== 'mixed') assert.ok(sel.every((q) => q.difficulty === difficulty));
      for (let i = 2; i < sel.length; i++) {
        assert.ok(!(sel[i].is_ai === sel[i - 1].is_ai && sel[i].is_ai === sel[i - 2].is_ai), 'no 3 iguales seguidas');
      }
      if (difficulty === 'mixed') sequences.add(sel.map((q) => q.id).join());
    }
  }
  assert.ok(sequences.size > 290, 'las secuencias no se repiten');
});

test('selección prioriza imágenes no vistas', () => {
  const first = selectQuestions(bank, { count: 10 });
  const second = selectQuestions(bank, { count: 10, recent: first.map((q) => q.id) });
  const overlap = second.filter((q) => first.some((f) => f.id === q.id)).length;
  assert.equal(overlap, 0);
});

test('contrarreloj recorre todo el banco sin repetir', () => {
  const seq = timeAttackSequence(bank, {});
  assert.equal(seq.length, bank.length);
  assert.equal(new Set(seq.map((q) => q.id)).size, bank.length);
});

test('validación de nombre', () => {
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('   ').ok, false);
  assert.equal(validateName('ab').ok, false);
  assert.equal(validateName('a'.repeat(21)).ok, false);
  assert.equal(validateName('<script>').ok, false);
  assert.equal(validateName('Robert"); DROP').ok, false);
  assert.equal(validateName('___').ok, false);
  assert.equal(validateName('  Ana   María ').value, 'Ana María');
  assert.equal(validateName('Ñandú_99').ok, true);
  assert.equal(validateName('José.P-2').ok, true);
  assert.equal(escapeHtml('<img onerror=x>'), '&lt;img onerror=x&gt;');
});

test('reglas coinciden con el SQL del servidor', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const rule = (k) => Number(sql.match(new RegExp(`when '${k}' then (\\d+)`))[1]);
  assert.equal(rule('base'), RULES.BASE_POINTS);
  assert.equal(rule('speed_bonus'), RULES.SPEED_BONUS);
  assert.equal(rule('classic_ms'), RULES.CLASSIC_TIME_MS);
  assert.equal(rule('speed_threshold_ms'), RULES.SPEED_THRESHOLD_MS);
  assert.equal(rule('streak3'), RULES.STREAK_BONUSES[3]);
  assert.equal(rule('streak5'), RULES.STREAK_BONUSES[5]);
  assert.equal(rule('timeattack_ms'), RULES.TIMEATTACK_MS);
  assert.equal(rule('classic_questions'), RULES.CLASSIC_QUESTIONS);
});
