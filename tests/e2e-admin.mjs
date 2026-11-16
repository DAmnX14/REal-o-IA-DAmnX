#!/usr/bin/env node
/**
 * Prueba E2E del PANEL DE ADMINISTRACIÓN en modo en línea (requiere tests/online/harness.mjs con ADMIN_*).
 *   E2E_SUPABASE_URL=... E2E_SUPABASE_KEY=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e-admin.mjs
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/`;
const { E2E_SUPABASE_URL: URL_, E2E_SUPABASE_KEY: KEY, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
let failures = 0;
const check = (c, m) => { if (!c) failures++; console.log(`  ${c ? '✓' : '✗'} ${m}`); };
const rpc = async (fn, body = {}) => (await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

const server = spawn(process.execPath, [`${ROOT}scripts/serve.mjs`, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Prueba de moderación' : undefined));
await page.route(/fonts\./, (r) => r.fulfill({ status: 200, body: '' }));
await page.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const CONFIG = { SUPABASE_URL: ${JSON.stringify(URL_)}, SUPABASE_ANON_KEY: ${JSON.stringify(KEY)}, OFFLINE_FALLBACK: false };` }));

try {
  console.log('\nREAL OR AI · E2E panel de administración (en línea)');
  await page.goto(`${BASE}admin/`);
  await page.waitForSelector('#view-login:not([hidden])');
  await page.fill('#login-email', ADMIN_EMAIL);
  await page.fill('#login-pass', 'contraseña-incorrecta');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#login-error').textContent.length > 0);
  check(/incorrectos/.test(await page.textContent('#login-error')), 'contraseña incorrecta rechazada');
  await page.fill('#login-pass', ADMIN_PASSWORD);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#view-panel:not([hidden])');
  await page.waitForSelector('#q-body tr[data-id]');
  check(await page.locator('#q-body tr[data-id]').count() === 50, 'administrador ve las 50 preguntas (RLS)');
  check((await page.textContent('#admin-user')) === ADMIN_EMAIL, 'sesión iniciada');

  // Filtros
  await page.selectOption('#q-f-class', 'IA');
  check(await page.locator('#q-body tr[data-id]').count() === 25, 'filtro por clasificación');
  await page.selectOption('#q-f-class', '');
  await page.selectOption('#q-f-diff', 'easy');
  check(await page.locator('#q-body tr[data-id]').count() === 10, 'filtro por dificultad');
  await page.selectOption('#q-f-diff', '');

  // Activar / desactivar
  await page.click('#q-body tr[data-id="q001"] .switch span');
  await page.waitForSelector('#q-body tr[data-id="q001"].inactive');
  let info = await rpc('get_bank_info');
  check(info.active === 49, `desactivar pregunta: el juego ve ${info.active} activas`);
  await page.click('#q-body tr[data-id="q001"] .switch span');
  await page.waitForSelector('#q-body tr[data-id="q001"]:not(.inactive)');
  info = await rpc('get_bank_info');
  check(info.active === 50, 'reactivar pregunta');

  // Editar
  await page.click('#q-body tr[data-id="q002"] [data-act="edit"]');
  await page.waitForSelector('#q-editor:not([hidden])');
  const oldTitle = await page.inputValue('#q-title');
  await page.fill('#q-title', `${oldTitle} (editado)`);
  await page.click('#q-save');
  await page.waitForSelector('#q-editor', { state: 'hidden' });
  await page.waitForFunction(() => /\(editado\)/.test(document.querySelector('#q-body tr[data-id="q002"]').textContent));
  check(true, 'editar título de una pregunta');
  await page.click('#q-body tr[data-id="q002"] [data-act="edit"]');
  await page.fill('#q-title', oldTitle);
  await page.click('#q-save');
  await page.waitForSelector('#q-editor', { state: 'hidden' });

  // Crear con subida de archivo
  await page.click('#btn-new-q');
  await page.waitForSelector('#q-editor:not([hidden])');
  await page.fill('#q-id', 'q-prueba-admin');
  await page.selectOption('#q-class', 'IA');
  await page.selectOption('#q-cat', 'objects');
  await page.selectOption('#q-diff', 'medium');
  await page.fill('#q-title', 'Pregunta creada desde el panel');
  await page.fill('#q-context', 'Contexto de prueba');
  await page.fill('#q-explanation', 'Explicación de prueba');
  await page.fill('#q-features', 'Rasgo 1\nRasgo 2');
  await page.fill('#q-tips', 'Consejo 1');
  await page.fill('#q-source', 'Prueba');
  await page.fill('#q-license', 'CC0');
  await page.click('#q-save');
  check(/herramienta/.test(await page.textContent('#q-form-error')), 'IA sin herramienta: validación');
  await page.fill('#q-tool', 'Herramienta de prueba');
  const bankFile = JSON.parse(readFileSync(`${ROOT}data/questions.json`)).questions[0].file;
  await page.setInputFiles('#q-file', `${ROOT}${bankFile}`);
  await page.waitForFunction(() => document.querySelector('#q-preview').src.startsWith('blob:'));
  check(true, 'vista previa del archivo subido');
  await page.click('#q-save');
  await page.waitForSelector('#q-editor', { state: 'hidden' });
  await page.waitForSelector('#q-body tr[data-id="q-prueba-admin"]');
  const src = await page.getAttribute('#q-body tr[data-id="q-prueba-admin"] img', 'src');
  check(/\/storage\/v1\/object\/public\/question-images\/[0-9a-f-]{36}\.jpg$/.test(src), `imagen subida a Storage con nombre neutro (${src.split('/').pop()})`);
  check(await page.evaluate((s) => fetch(s).then((r) => r.ok), src), 'la imagen subida es accesible');
  info = await rpc('get_bank_info');
  check(info.total === 51 && info.ai === 26, 'el banco se amplía sin tocar el código');

  // Eliminar
  await page.click('#q-body tr[data-id="q-prueba-admin"] [data-act="delete"]');
  await page.waitForSelector('#q-body tr[data-id="q-prueba-admin"]', { state: 'detached' });
  info = await rpc('get_bank_info');
  check(info.total === 50, 'eliminar pregunta');

  // Jugadores: suspender
  const before = await rpc('get_ranking', { p_mode: 'classic', p_search: null, p_limit: 10, p_offset: 0 });
  await page.click('[data-tab="players"]');
  await page.waitForSelector('#p-body tr[data-id]');
  check(await page.locator('#p-body tr[data-id]').count() >= 1, 'listado de jugadores');
  const name = before.rows[0]?.name;
  const row = page.locator('#p-body tr[data-id]', { hasText: name }).first();
  await row.locator('[data-ban="1"]').click();
  await page.waitForSelector('#p-body tr.flagged');
  let after = await rpc('get_ranking', { p_mode: 'classic', p_search: name, p_limit: 10, p_offset: 0 });
  check(after.total === 0, `jugador suspendido sale del ranking (${name})`);
  await page.locator('#p-body tr[data-id]', { hasText: name }).first().locator('[data-ban="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#p-body tr.flagged'));
  after = await rpc('get_ranking', { p_mode: 'classic', p_search: name, p_limit: 10, p_offset: 0 });
  check(after.total === 1, 'jugador rehabilitado vuelve al ranking');

  // Partidas: marcar fraude
  await page.click('[data-tab="games"]');
  await page.selectOption('#g-f-mode', 'classic');
  await page.selectOption('#g-f-status', 'finished');
  await page.waitForSelector('#g-body tr[data-id]');
  const grow = page.locator('#g-body tr[data-id]:not(.flagged)').first();
  const gid = await grow.getAttribute('data-id');
  await grow.locator('[data-act="detail"]').click();
  await page.waitForSelector('#g-detail-body table');
  check(await page.locator('#g-detail-body tbody tr').count() === 10, 'detalle de partida: 10 respuestas con tiempos');
  await page.click('#g-detail [data-close]');
  await page.locator(`#g-body tr[data-id="${gid}"] [data-act="flag"]`).click();
  await page.waitForSelector(`#g-body tr[data-id="${gid}"].flagged`);
  after = await rpc('get_ranking', { p_mode: 'classic', p_search: null, p_limit: 10, p_offset: 0 });
  check(after.total === before.total - 1 || after.rows[0]?.score !== before.rows[0]?.score, 'partida marcada como fraude sale del ranking');
  await page.locator(`#g-body tr[data-id="${gid}"] [data-act="flag"]`).click();
  await page.waitForSelector(`#g-body tr[data-id="${gid}"]:not(.flagged)`);

  // Estadísticas
  await page.click('[data-tab="stats"]');
  await page.waitForSelector('#admin-kpis .kpi');
  check(await page.locator('#admin-kpis .kpi').count() === 6, 'estadísticas de administración');
  await page.waitForSelector('#perq-body tr');
  check(await page.locator('#perq-body tr').count() === 50, 'dificultad real por imagen (50)');
  await page.screenshot({ path: `${ROOT}tests/screenshots/14-admin-estadisticas.png`, fullPage: true });
  await page.click('[data-tab="questions"]');
  await page.waitForSelector('#q-body tr[data-id]');
  await page.screenshot({ path: `${ROOT}tests/screenshots/15-admin-preguntas.png` });

  // Cerrar sesión
  await page.click('#btn-logout');
  await page.waitForSelector('#view-login:not([hidden])');
  check(true, 'cerrar sesión');
  check(errors.length === 0, `sin errores de JavaScript (${errors.join(' | ') || 'ninguno'})`);
} catch (e) {
  failures++; console.error('ERROR FATAL:', e);
} finally {
  await browser.close(); server.kill();
}
console.log(`\n${failures ? `✗ ${failures} verificación(es) fallida(s)` : '✓ Todas las verificaciones del panel pasaron'}`);
process.exit(failures ? 1 : 0);
