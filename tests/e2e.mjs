#!/usr/bin/env node
/**
 * Prueba de punta a punta con Playwright (navegador real).
 *   node tests/e2e.mjs                 → modo local (sin Supabase)
 *   E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_KEY=... node tests/e2e.mjs   → modo en línea
 *
 * Requiere el paquete "playwright" disponible (npm i -D playwright && npx playwright install chromium).
 * Las capturas se guardan en tests/screenshots/.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = `${ROOT}tests/screenshots/`;
const ONLINE = Boolean(process.env.E2E_SUPABASE_URL);
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const results = [];
function check(cond, msg) {
  if (cond) results.push(`  ✓ ${msg}`);
  else { failures++; results.push(`  ✗ ${msg}`); }
  console.log(results.at(-1));
}

const server = spawn(process.execPath, [`${ROOT}scripts/serve.mjs`, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/ERR_TUNNEL|ERR_NAME|ERR_CONNECTION/.test(m.text())) page.errors.push(m.text()); });
  // Sin acceso a Google Fonts en entornos aislados: se responde vacío (el sitio usa fuentes del sistema como respaldo).
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (ONLINE) {
    await page.route('**/js/config.js', (r) => r.fulfill({
      contentType: 'text/javascript',
      body: `export const CONFIG = { SUPABASE_URL: ${JSON.stringify(process.env.E2E_SUPABASE_URL)}, SUPABASE_ANON_KEY: ${JSON.stringify(process.env.E2E_SUPABASE_KEY)}, OFFLINE_FALLBACK: false };`,
    }));
  }
  return page;
}

/** Devuelve la respuesta correcta de la imagen en pantalla (solo para pruebas). */
async function correctAnswer(page) {
  return page.evaluate(async () => {
    const st = window.__REALORAI__.app.controller.state;
    const backend = await window.__REALORAI__.getBackend();
    if (backend.kind === 'local') return backend.games.get(st.gameId).pending.q.is_ai ? 'ai' : 'real';
    return window.__E2E_ANSWERS__?.[st.current.questionId] ?? null;
  });
}

async function waitQuestion(page) {
  await page.waitForFunction(() => window.__REALORAI__?.app.controller?.state?.phase === 'question', null, { timeout: 20000 });
}

try {
  /* =============== 1. Inicio =============== */
  console.log(`\nREAL OR AI · E2E (${ONLINE ? 'EN LÍNEA – Supabase/PostgREST' : 'LOCAL'})`);
  const page = await newPage();
  if (ONLINE) {
    // Mapa de respuestas solo para la prueba (el juego en línea nunca las recibe antes de responder).
    const answers = Object.fromEntries((await (await fetch(`${BASE}data/questions.json`)).json()).questions.map((q) => [q.id, q.classification === 'IA' ? 'ai' : 'real']));
    await page.addInitScript((a) => { window.__E2E_ANSWERS__ = a; }, answers);
  }
  await page.goto(BASE);
  await page.waitForFunction(() => /imágenes verificadas/.test(document.querySelector('#bank-status')?.textContent || ''), null, { timeout: 30000 });
  const bankText = await page.textContent('#bank-status');
  check(/50 imágenes verificadas \(25 reales · 25 IA\)/.test(bankText), `banco verificado al iniciar: "${bankText}"`);
  check(await page.textContent('#conn-status').then((t) => (ONLINE ? /En línea/ : /Modo local/).test(t)), 'indicador de conexión correcto');
  check(await page.locator('#intro-stack img').count() >= 6, 'animación de introducción con imágenes');
  check(await page.isVisible('text=¿Podés distinguir lo real de lo artificial?'), 'eslogan visible');
  check(/ArceTech®/.test((await page.textContent('.site-footer')).replace(/\s+/g, '')), 'marca ArceTech® en el pie');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}01-inicio.png` });

  /* =============== 2. Nombre =============== */
  await page.click('#btn-play');
  await page.waitForSelector('#screen-name:not([hidden])');
  for (const [bad, why] of [['', 'vacío'], ['ab', 'corto'], ['<script>', 'peligroso'], ['   ', 'solo espacios']]) {
    await page.fill('#player-name', bad);
    await page.click('#name-form button[type=submit]');
    const err = await page.textContent('#name-error');
    const stillThere = await page.isVisible('#screen-name');
    check(stillThere && err.length > 5, `nombre ${why} rechazado ("${err}")`);
  }
  await page.fill('#player-name', 'x'.repeat(25));
  check((await page.inputValue('#player-name')).length === 20, 'el campo limita a 20 caracteres');
  check(await page.evaluate(() => window.__REALORAI__.music.track) === 'menu', 'música de inicio sonando tras el primer clic');
  await page.fill('#player-name', 'Tester E2E');
  await page.click('#name-form button[type=submit]');
  await page.waitForSelector('#screen-mode:not([hidden])');
  check((await page.textContent('#welcome-title')) === '¡Hola, Tester E2E!', 'bienvenida personalizada');
  await page.screenshot({ path: `${SHOTS}02-modos.png` });

  /* =============== 3. Partida clásica =============== */
  await page.click('#btn-start');
  await waitQuestion(page);
  check((await page.textContent('#hud-player')) === 'Tester E2E', 'HUD muestra el nombre');
  check((await page.textContent('#hud-qnum')) === '1/10', 'HUD muestra pregunta 1/10');
  const t0 = Number(await page.textContent('#hud-timer-text'));
  check(t0 >= 14 && t0 <= 15, `temporizador arranca en 15 (${t0})`);
  check(await page.evaluate(() => document.querySelector('#q-image').naturalWidth > 0), 'la imagen carga');
  check(await page.evaluate(() => {
    const s = document.querySelector('#stage').getBoundingClientRect(); const i = document.querySelector('#q-image');
    const k = Math.min(i.clientWidth / i.naturalWidth, i.clientHeight / i.naturalHeight); // object-fit: contain
    const w = i.naturalWidth * k, h = i.naturalHeight * k;
    return w <= s.width + 1 && h <= s.height + 1;
  }), 'la imagen entra completa en el recuadro');
  check(await page.isVisible('#btn-music'), 'botón de música visible');
  check(await page.evaluate(() => window.__REALORAI__.music.track) === 'suspense', 'música de suspenso durante la partida');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}03-juego.png` });

  const seen = new Set();
  let expected = 0; let streak = 0;
  const plan = ['correct', 'wrong', 'timeout', 'correct', 'correct', 'correct', 'correct', 'correct', 'slow', 'correct'];
  for (let i = 0; i < 10; i++) {
    await waitQuestion(page);
    const qid = await page.evaluate(() => window.__REALORAI__.app.controller.state.current.questionId);
    check(!seen.has(qid), `pregunta ${i + 1} no repetida`);
    seen.add(qid);
    const right = await correctAnswer(page);
    const kind = plan[i];
    if (kind === 'timeout') {
      await page.waitForTimeout(3000);
      const t = Number(await page.textContent('#hud-timer-text'));
      check(t <= 13 && t >= 11, `cuenta regresiva avanza (${t})`);
      await page.waitForSelector('#feedback:not([hidden])', { timeout: 17000 });
      check(/TIEMPO AGOTADO/.test(await page.textContent('.fb-verdict')), 'al llegar a cero: TIEMPO AGOTADO');
      check(await page.isDisabled('#btn-real'), 'botones bloqueados tras tiempo agotado');
      streak = 0;
    } else {
      if (kind === 'slow') await page.waitForTimeout(6000);
      const choice = kind === 'wrong' ? (right === 'ai' ? 'real' : 'ai') : right;
      // doble clic rápido: solo debe registrarse UNA respuesta
      await page.locator(`#btn-${choice}`).dblclick();
      await page.waitForSelector('#feedback:not([hidden])');
      if (kind === 'wrong') { streak = 0; check(/INCORRECTO/.test(await page.textContent('.fb-verdict')), 'respuesta incorrecta detectada'); }
      else {
        streak++;
        expected += 100 + (kind === 'slow' ? 0 : 50) + (streak === 3 ? 50 : streak === 5 ? 100 : 0);
        check(/CORRECTO/.test(await page.textContent('.fb-verdict')), `respuesta correcta ${i + 1}`);
      }
    }
    const answered = await page.evaluate(() => window.__REALORAI__.app.controller.state.answered);
    check(answered === i + 1, `una sola respuesta registrada (${answered})`);
    if (i === 0) {
      const fb = await page.textContent('#feedback-body');
      check(/FOTOGRAFÍA REAL|GENERADA POR IA/.test(fb), 'devolución muestra la clasificación verdadera');
      check(/Contexto/.test(fb) && /Procedencia documentada/.test(fb) && /Licencia/.test(fb), 'devolución con contexto y procedencia');
      check(await page.locator('.fb-list li').count() >= 4, 'características y consejos listados');
      check(await page.locator('.fb-panel:not([hidden])').count() === 1, 'explicación compacta: una sola sección visible a la vez');
      await page.click('#fbt-tips');
      check(await page.isVisible('#fbp-tips') && !(await page.isVisible('#fbp-observe')), 'pestañas de la explicación funcionan');
      await page.waitForTimeout(900);
      check(/\+50 bonus por rapidez/.test(fb), 'bonus por rapidez mostrado');
      await page.screenshot({ path: `${SHOTS}04-devolucion.png` });
    }
    if (i === 8) check(!/rapidez/.test(await page.textContent('#feedback-body')), 'sin bonus si quedaban ≤ 10 s');
    await page.click('#btn-continue');
  }
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 20000 });
  const scoreTxt = await page.textContent('.stat.big .stat-v');
  check(Number(scoreTxt.replace(/\D/g, '')) === expected, `puntaje calculado ${scoreTxt} = esperado ${expected}`);
  const res = await page.textContent('#results-body');
  check(/8 de 10/.test(res), 'resultados: 8 de 10 (1 error, 1 sin responder)');
  check(/¡Tenés muy buen ojo!/.test(res), 'calificación para 8 aciertos');
  for (const k of ['Respuestas correctas', 'Respuestas incorrectas', 'Porcentaje de aciertos', 'Tiempo promedio', 'Mejor racha', 'Duración de la partida']) check(res.includes(k), `resultado incluye "${k}"`);
  check(/puesto #1/.test(res), 'posición en el ranking informada');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}05-resultados.png`, fullPage: true });

  /* =============== 4. Ranking =============== */
  await page.click('#btn-results-ranking');
  await page.waitForSelector('#rank-body tr.gold');
  check(/Tester E2E/.test(await page.textContent('#rank-body tr.gold')), 'ranking: primer puesto en oro');
  check(Number((await page.textContent('#rank-body tr.gold td.num')).replace(/\D/g, '')) === expected, 'ranking muestra el puntaje');
  await page.fill('#rank-search', 'nadie-asi');
  await page.waitForFunction(() => /No se encontraron/.test(document.querySelector('#rank-body').textContent));
  check(true, 'buscador filtra por nombre');
  await page.fill('#rank-search', 'tester');
  await page.waitForSelector('#rank-body tr.gold');
  await page.screenshot({ path: `${SHOTS}06-ranking.png` });

  /* =============== 5. Persistencia =============== */
  const page2 = ONLINE ? await newPage() : page; // en línea: otro "dispositivo" (contexto nuevo, sin localStorage)
  if (ONLINE) await page2.goto(`${BASE}#/ranking`); else await page2.reload();
  if (!ONLINE) await page2.goto(`${BASE}#/ranking`);
  await page2.waitForSelector('#rank-body tr.gold', { timeout: 20000 });
  check(/Tester E2E/.test(await page2.textContent('#rank-body')), ONLINE ? 'ranking compartido visible desde otro dispositivo' : 'ranking persiste tras recargar');
  if (!ONLINE) {
    await page.goto(BASE);
    await page.click('#btn-play');
    await page.waitForSelector('#screen-mode:not([hidden])');
    check((await page.textContent('#welcome-title')).includes('Tester E2E'), 'recuerda el último nombre');
  }

  /* =============== 6. Aprendizaje =============== */
  await page.goto(BASE);
  await page.click('#btn-play');
  if (await page.isVisible('#screen-name')) { await page.fill('#player-name', 'Tester E2E'); await page.click('#name-form button[type=submit]'); }
  await page.waitForSelector('#screen-mode:not([hidden])');
  await page.check('input[name=mode][value=learning]', { force: true });
  await page.check('input[name=difficulty][value=hard]', { force: true });
  await page.click('#btn-start');
  await waitQuestion(page);
  check((await page.textContent('#hud-timer-text')) === '∞', 'aprendizaje: sin límite de tiempo');
  check(await page.isVisible('#learning-guide'), 'aprendizaje: guía de observación visible');
  await page.waitForTimeout(1200);
  check((await page.evaluate(() => window.__REALORAI__.app.controller.state.phase)) === 'question', 'aprendizaje: no expira');
  for (let i = 0; i < 10; i++) {
    await waitQuestion(page);
    const diff = await page.evaluate(() => window.__REALORAI__.app.controller.state.current.difficulty);
    if (diff !== 'hard') check(false, 'dificultad difícil respetada');
    await page.click(`#btn-${(await correctAnswer(page)) || 'real'}`);
    await page.waitForSelector('#feedback:not([hidden])');
    if (i === 0) { check(await page.isVisible('.fb-learn'), 'aprendizaje: explicación ampliada'); await page.screenshot({ path: `${SHOTS}07-aprendizaje.png` }); }
    await page.click('#btn-continue');
  }
  await page.waitForSelector('#screen-results:not([hidden])');
  check(/no suma al ranking/.test(await page.textContent('#results-body')), 'aprendizaje no afecta el ranking');

  /* =============== 7. Contrarreloj =============== */
  await page.click('#btn-results-modes');
  await page.check('input[name=mode][value=timeattack]', { force: true });
  await page.check('input[name=difficulty][value=mixed]', { force: true });
  await page.click('#btn-start');
  await waitQuestion(page);
  const started = Date.now();
  let n = 0;
  while (Date.now() - started < 20000) {
    await waitQuestion(page).catch(() => {});
    const r = await correctAnswer(page).catch(() => null);
    if (!r) break;
    await page.click(`#btn-${r}`).catch(() => {});
    n++;
    await page.waitForTimeout(150);
  }
  check(n >= 8, `contrarreloj: varias imágenes respondidas (${n})`);
  await page.screenshot({ path: `${SHOTS}08-contrarreloj.png` });
  await page.waitForSelector('#screen-results:not([hidden])', { timeout: 60000 });
  check(Date.now() - started >= 38000, 'contrarreloj termina al agotarse los 60 s');
  const ta = await page.textContent('#results-body');
  check(/Contrarreloj/.test(ta) && /Puntaje total/.test(ta), 'contrarreloj muestra resultados al finalizar');

  /* =============== 8. Estadísticas, cómo jugar, créditos =============== */
  await page.goto(`${BASE}#/estadisticas`);
  await page.waitForSelector('.kpi-grid');
  check(await page.locator('.kpi').count() === 6, 'estadísticas: indicadores');
  check(await page.locator('#ch-dist svg.donut').count() === 1, 'gráfico circular');
  check(await page.locator('#ch-cats .hbar-row').count() > 0, 'gráfico de barras');
  check(await page.locator('#ch-timeline svg.line-chart').count() === 1, 'gráfico de evolución temporal');
  await page.hover('#ch-cats .hbar-row');
  check(await page.isVisible('.chart-tooltip.visible'), 'gráficos interactivos (tooltip)');
  await page.screenshot({ path: `${SHOTS}09-estadisticas.png`, fullPage: true });
  await page.goto(`${BASE}#/como-jugar`);
  check(await page.isVisible('text=Racha de 5 aciertos seguidos'), 'pantalla cómo jugar');
  await page.goto(`${BASE}#/creditos`);
  await page.waitForSelector('.credits-table tbody tr');
  check(await page.locator('.credits-table tbody tr').count() === 50, 'créditos de las 50 imágenes');

  /* =============== 9. Celular =============== */
  const mobile = await newPage({ ...devices['iPhone 13'] });
  await mobile.goto(BASE);
  await mobile.waitForFunction(() => /imágenes verificadas/.test(document.querySelector('#bank-status')?.textContent || ''));
  check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'celular: sin desbordamiento horizontal (inicio)');
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: `${SHOTS}10-movil-inicio.png` });
  await mobile.tap('#btn-play');
  await mobile.fill('#player-name', 'Movil Test');
  await mobile.tap('#name-form button[type=submit]');
  await mobile.tap('#btn-start');
  await waitQuestion(mobile);
  const box = await mobile.locator('#btn-ai').boundingBox();
  const vh = mobile.viewportSize().height;
  check(box && box.y + box.height <= vh, `celular: botones de respuesta visibles sin desplazar (${Math.round(box?.y + box?.height)} ≤ ${vh})`);
  check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'celular: sin desbordamiento horizontal (juego)');
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: `${SHOTS}11-movil-juego.png` });
  await mobile.tap(`#btn-${(await correctAnswer(mobile)) || 'real'}`);
  await mobile.waitForSelector('#feedback:not([hidden])');
  await mobile.screenshot({ path: `${SHOTS}12-movil-devolucion.png` });
  check(await mobile.isVisible('#btn-continue'), 'celular: botón continuar accesible');

  /* =============== 10. Administración =============== */
  const admin = await newPage();
  await admin.goto(`${BASE}admin/`);
  if (!ONLINE) {
    await admin.waitForSelector('#view-unconfigured:not([hidden])');
    check(true, 'admin sin Supabase: instrucciones de configuración');
    await admin.click('#btn-local-preview');
    await admin.waitForSelector('#q-body tr[data-id]');
    check(await admin.locator('#q-body tr[data-id]').count() === 50, 'admin: vista previa del banco (50)');
    await admin.selectOption('#q-f-class', 'IA');
    check(await admin.locator('#q-body tr[data-id]').count() === 25, 'admin: filtro por clasificación');
    await admin.screenshot({ path: `${SHOTS}13-admin-local.png` });
  } else {
    await admin.waitForSelector('#view-login:not([hidden])');
    check(true, 'admin en línea: pide inicio de sesión');
  }

  for (const p of [page, mobile, admin]) check(p.errors.length === 0, `sin errores de JavaScript (${p.errors.slice(0, 3).join(' | ') || 'ninguno'})`);
} catch (e) {
  failures++;
  console.error('ERROR FATAL:', e);
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${failures ? `✗ ${failures} verificación(es) fallida(s)` : '✓ Todas las verificaciones E2E pasaron'}`);
process.exit(failures ? 1 : 0);
