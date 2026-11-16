/**
 * admin.js — Panel de administración (requiere Supabase Auth + tabla admins).
 *
 * La seguridad NO depende de este archivo: aunque alguien lo modifique, las políticas RLS
 * de la base de datos solo permiten leer/escribir a usuarios registrados en public.admins.
 */
import { isSupabaseConfigured, getSupabaseClient, loadLocalBank } from './database.js';
import { renderStats } from './statistics.js';
import {
  $, $$, el, escapeHtml, resolveImageUrl, formatDate, formatPercent, formatSeconds, formatNumber, debounce,
  CATEGORY_LABELS, DIFFICULTY_LABELS, MODE_LABELS,
} from './utils.js';

const BUCKET = 'question-images';
const MAX_UPLOAD = 5 * 1024 * 1024;
let sb = null;
let questions = [];
let readOnly = false;

/* ---------------- Utilidades ---------------- */

function toast(msg, type = 'info') {
  const t = el('div', { class: `toast ${type}`, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4000);
}

function showView(id) {
  for (const v of ['view-unconfigured', 'view-login', 'view-panel']) $('#' + v).hidden = v !== id;
}

function openDialog(id) { const d = $('#' + id); d.hidden = false; requestAnimationFrame(() => d.classList.add('open')); }
function closeDialog(id) { const d = $('#' + id); d.classList.remove('open'); d.hidden = true; }
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('.feedback').id)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ['q-editor', 'g-detail'].forEach(closeDialog); });

function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/* ---------------- Autenticación ---------------- */

async function init() {
  const catOpts = Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('');
  $('#q-f-cat').insertAdjacentHTML('beforeend', catOpts);
  $('#q-cat').innerHTML = catOpts;
  bindPanel();

  if (!isSupabaseConfigured()) {
    showView('view-unconfigured');
    $('#btn-local-preview').addEventListener('click', openLocalPreview);
    return;
  }
  sb = await getSupabaseClient();
  $('#login-form').addEventListener('submit', login);
  $('#btn-logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session); else showView('view-login');
}

async function login(e) {
  e.preventDefault();
  const err = $('#login-error');
  err.textContent = '';
  const btn = e.submitter; btn.disabled = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) throw new Error('Correo o contraseña incorrectos.');
    await enter(data.session);
  } catch (ex) {
    err.textContent = ex.message;
  } finally { btn.disabled = false; }
}

async function enter(session) {
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    await sb.auth.signOut();
    showView('view-login');
    $('#login-error').textContent = 'Esta cuenta no tiene permisos de administrador.';
    return;
  }
  $('#admin-user').textContent = session.user.email;
  $('#btn-logout').hidden = false;
  showView('view-panel');
  await loadQuestions();
}

/* ---------------- Vista local de solo lectura ---------------- */

async function openLocalPreview() {
  readOnly = true;
  const { questions: qs, report } = await loadLocalBank();
  questions = qs.map((q) => ({ ...q, image_url: q.file }));
  showView('view-panel');
  $$('[data-tab]').forEach((b) => { if (b.dataset.tab !== 'questions') b.hidden = true; });
  $('#btn-new-q').hidden = true;
  $('#admin-user').textContent = 'Solo lectura (sin Supabase)';
  toast(`Banco local: ${report.valid} imágenes verificadas (${report.real} reales, ${report.ai} IA).`);
  renderQuestions();
}

/* ---------------- Pestañas ---------------- */

function bindPanel() {
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
    ({ questions: loadQuestions, players: loadPlayers, games: loadGames, stats: loadAdminStats })[b.dataset.tab]();
  }));
  ['#q-f-class', '#q-f-cat', '#q-f-diff', '#q-f-active'].forEach((s) => $(s).addEventListener('change', renderQuestions));
  $('#q-search').addEventListener('input', debounce(renderQuestions, 200));
  $('#btn-new-q').addEventListener('click', () => openEditor(null));
  $('#q-form').addEventListener('submit', saveQuestion);
  $('#q-file').addEventListener('change', previewFile);
  $('#q-image-url').addEventListener('input', () => setPreview(resolveImageUrl($('#q-image-url').value.trim())));
  $('#p-refresh').addEventListener('click', loadPlayers);
  $('#p-search').addEventListener('input', debounce(loadPlayers, 300));
  $('#g-refresh').addEventListener('click', loadGames);
  $('#g-f-mode').addEventListener('change', loadGames);
  $('#g-f-status').addEventListener('change', loadGames);
}

/* ---------------- Preguntas ---------------- */

async function loadQuestions() {
  if (readOnly) return renderQuestions();
  try {
    questions = must(await sb.from('questions').select('*').order('id'));
    renderQuestions();
  } catch (e) { toast(e.message, 'error'); }
}

function renderQuestions() {
  const s = $('#q-search').value.trim().toLowerCase();
  const fc = $('#q-f-class').value, fcat = $('#q-f-cat').value, fd = $('#q-f-diff').value, fa = $('#q-f-active').value;
  const list = questions.filter((q) => (!s || q.title.toLowerCase().includes(s) || q.id.includes(s))
    && (!fc || (fc === 'IA') === q.is_ai) && (!fcat || q.category === fcat) && (!fd || q.difficulty === fd)
    && (!fa || String(Number(q.active)) === fa));
  const act = questions.filter((q) => q.active);
  $('#q-summary').textContent = `${questions.length} preguntas · ${act.length} activas (${act.filter((q) => !q.is_ai).length} reales, ${act.filter((q) => q.is_ai).length} IA) · mostrando ${list.length}`;
  $('#q-body').innerHTML = list.map((q) => `
    <tr class="${q.active ? '' : 'inactive'}" data-id="${escapeHtml(q.id)}">
      <td><img class="thumb" src="${escapeHtml(resolveImageUrl(q.image_url))}" alt="" loading="lazy"></td>
      <td class="title-cell"><strong>${escapeHtml(q.title)}</strong><code>${escapeHtml(q.id)}</code></td>
      <td><span class="badge ${q.is_ai ? 'badge-ai' : 'badge-real'}">${q.is_ai ? 'IA' : 'REAL'}</span></td>
      <td>${escapeHtml(CATEGORY_LABELS[q.category] || q.category)}</td>
      <td>${escapeHtml(DIFFICULTY_LABELS[q.difficulty] || q.difficulty)}</td>
      <td class="prov-cell">${escapeHtml(q.author || '—')}<br>${q.source_url ? `<a href="${escapeHtml(q.source_url)}" target="_blank" rel="noopener">${escapeHtml(q.source)}</a>` : escapeHtml(q.source)} · ${escapeHtml(q.license)}${q.ai_tool ? `<br>🤖 ${escapeHtml(q.ai_tool)}` : ''}</td>
      <td><label class="switch" title="Activar / desactivar"><input type="checkbox" data-act="toggle" ${q.active ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span></span></label></td>
      <td class="actions">
        <button class="btn btn-ghost btn-sm" data-act="edit" type="button">${readOnly ? 'Ver' : 'Editar'}</button>
        ${readOnly ? '' : '<button class="btn btn-ghost btn-sm" data-act="delete" type="button">Eliminar</button>'}
      </td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-row">Sin resultados.</td></tr>';
  $$('#q-body tr[data-id]').forEach((tr) => {
    const q = questions.find((x) => x.id === tr.dataset.id);
    tr.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(q));
    tr.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteQuestion(q));
    tr.querySelector('[data-act="toggle"]').addEventListener('change', (e) => toggleActive(q, e.target.checked));
  });
}

async function toggleActive(q, active) {
  try {
    must(await sb.from('questions').update({ active }).eq('id', q.id).select());
    q.active = active;
    toast(active ? 'Pregunta activada.' : 'Pregunta desactivada.');
    renderQuestions();
  } catch (e) { toast(e.message, 'error'); loadQuestions(); }
}

async function deleteQuestion(q) {
  if (!confirm(`¿Eliminar definitivamente "${q.title}"? Se conservarán las estadísticas de partidas pasadas sin la pregunta.`)) return;
  try {
    must(await sb.from('questions').delete().eq('id', q.id).select());
    if (q.storage_path) await sb.storage.from(BUCKET).remove([q.storage_path]);
    toast('Pregunta eliminada.');
    loadQuestions();
  } catch (e) { toast(e.message, 'error'); }
}

let editing = null;
function setPreview(src) {
  const img = $('#q-preview');
  if (src) { img.src = src; $('#q-preview-empty').hidden = true; } else { img.removeAttribute('src'); $('#q-preview-empty').hidden = false; }
}

function previewFile() {
  const f = $('#q-file').files[0];
  if (!f) return;
  if (f.size > MAX_UPLOAD) { toast('El archivo supera los 5 MB.', 'error'); $('#q-file').value = ''; return; }
  setPreview(URL.createObjectURL(f));
}

function openEditor(q) {
  editing = q;
  $('#q-editor-title').textContent = q ? (readOnly ? 'Detalle de la pregunta' : 'Editar pregunta') : 'Nueva pregunta';
  const v = (id, val) => { $(id).value = val ?? ''; };
  v('#q-id', q?.id || `q-${Date.now().toString(36)}`);
  $('#q-id').readOnly = !!q;
  v('#q-class', q ? (q.is_ai ? 'IA' : 'REAL') : 'REAL');
  v('#q-cat', q?.category || 'people');
  v('#q-diff', q?.difficulty || 'medium');
  v('#q-title', q?.title); v('#q-context', q?.context); v('#q-explanation', q?.explanation);
  v('#q-features', (q?.features || []).join('\n')); v('#q-tips', (q?.tips || []).join('\n'));
  v('#q-source', q?.source); v('#q-source-url', q?.source_url); v('#q-author', q?.author);
  v('#q-tool', q?.ai_tool); v('#q-license', q?.license); v('#q-license-url', q?.license_url);
  v('#q-image-url', q?.image_url);
  $('#q-active').checked = q ? q.active !== false : true;
  $('#q-file').value = '';
  $('#q-form-error').textContent = '';
  setPreview(q ? resolveImageUrl(q.image_url) : '');
  $$('#q-form input, #q-form select, #q-form textarea').forEach((x) => { x.disabled = readOnly; });
  $('#q-save').hidden = readOnly;
  openDialog('q-editor');
}

async function saveQuestion(e) {
  e.preventDefault();
  if (readOnly) return;
  const err = $('#q-form-error');
  err.textContent = '';
  const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
  const row = {
    id: $('#q-id').value.trim(),
    is_ai: $('#q-class').value === 'IA',
    category: $('#q-cat').value,
    difficulty: $('#q-diff').value,
    title: $('#q-title').value.trim(),
    context: $('#q-context').value.trim(),
    explanation: $('#q-explanation').value.trim(),
    features: lines('#q-features'),
    tips: lines('#q-tips'),
    source: $('#q-source').value.trim(),
    source_url: $('#q-source-url').value.trim() || null,
    author: $('#q-author').value.trim() || null,
    ai_tool: $('#q-tool').value.trim() || null,
    license: $('#q-license').value.trim(),
    license_url: $('#q-license-url').value.trim() || null,
    active: $('#q-active').checked,
    image_url: $('#q-image-url').value.trim(),
  };
  if (!/^[a-z0-9-]{3,40}$/.test(row.id)) { err.textContent = 'ID inválido (minúsculas, números y guiones).'; return; }
  if (row.is_ai && !row.ai_tool) { err.textContent = 'Indicá la herramienta de IA utilizada (o "No especificada por el autor").'; return; }
  const file = $('#q-file').files[0];
  if (!file && !row.image_url) { err.textContent = 'Subí una imagen o indicá su ruta/URL.'; return; }
  const btn = $('#q-save'); btn.disabled = true; btn.classList.add('loading');
  try {
    if (file) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Formato no permitido.');
      // Nombre neutro: no revela la clasificación en la URL
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
      row.image_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      if (editing?.storage_path) await sb.storage.from(BUCKET).remove([editing.storage_path]);
      row.storage_path = path;
    }
    if (editing) must(await sb.from('questions').update(row).eq('id', editing.id).select());
    else must(await sb.from('questions').insert(row).select());
    toast('Pregunta guardada.');
    closeDialog('q-editor');
    loadQuestions();
  } catch (ex) {
    err.textContent = ex.message;
  } finally { btn.disabled = false; btn.classList.remove('loading'); }
}

/* ---------------- Jugadores ---------------- */

async function loadPlayers() {
  const body = $('#p-body');
  body.innerHTML = '<tr><td colspan="7" class="loading-row"><span class="spinner"></span></td></tr>';
  try {
    let qy = sb.from('players').select('id,name,banned,created_at,games(mode,score,status,flagged)').order('created_at', { ascending: false }).limit(500);
    const s = $('#p-search').value.trim();
    if (s) qy = qy.ilike('name', `%${s.replace(/[%_]/g, '')}%`);
    const players = must(await qy);
    body.innerHTML = players.map((p) => {
      const fin = (p.games || []).filter((g) => g.status === 'finished' && !g.flagged);
      const best = (m) => { const xs = fin.filter((g) => g.mode === m).map((g) => g.score); return xs.length ? Math.max(...xs) : '—'; };
      return `<tr class="${p.banned ? 'flagged' : ''}" data-id="${p.id}">
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td class="num">${(p.games || []).length}</td>
        <td class="num">${best('classic')}</td><td class="num">${best('timeattack')}</td>
        <td>${formatDate(p.created_at)}</td>
        <td>${p.banned ? '<span class="pill error">Suspendido</span>' : '<span class="pill online">Activo</span>'}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" type="button" data-ban="${p.banned ? 0 : 1}">${p.banned ? 'Rehabilitar' : 'Suspender'}</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty-row">Sin jugadores.</td></tr>';
    $$('#p-body [data-ban]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id;
      const banned = b.dataset.ban === '1';
      if (banned && !confirm('¿Suspender a este jugador? Sus partidas dejarán de aparecer en el ranking.')) return;
      try { must(await sb.from('players').update({ banned }).eq('id', id).select()); toast(banned ? 'Jugador suspendido.' : 'Jugador rehabilitado.'); loadPlayers(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) { body.innerHTML = `<tr><td colspan="7" class="error-row">${escapeHtml(e.message)}</td></tr>`; }
}

/* ---------------- Partidas ---------------- */

async function loadGames() {
  const body = $('#g-body');
  body.innerHTML = '<tr><td colspan="8" class="loading-row"><span class="spinner"></span></td></tr>';
  try {
    let qy = sb.from('games').select('id,mode,difficulty,status,score,correct,wrong,unanswered,answered_ms,answered_count,started_at,finished_at,flagged,flag_reason,players(name)')
      .order('started_at', { ascending: false }).limit(300);
    const m = $('#g-f-mode').value, st = $('#g-f-status').value;
    if (m) qy = qy.eq('mode', m);
    if (st === 'flagged') qy = qy.eq('flagged', true); else if (st) qy = qy.eq('status', st);
    const games = must(await qy);
    body.innerHTML = games.map((g) => {
      const total = g.correct + g.wrong + g.unanswered;
      return `<tr class="${g.flagged ? 'flagged' : ''}" data-id="${g.id}">
        <td>${new Date(g.started_at).toLocaleString('es-AR')}</td>
        <td>${escapeHtml(g.players?.name || '—')}</td>
        <td>${escapeHtml(MODE_LABELS[g.mode])}<br><small class="muted">${escapeHtml(DIFFICULTY_LABELS[g.difficulty])}</small></td>
        <td class="num">${formatNumber(g.score)}</td>
        <td class="num">${g.correct}/${total} (${formatPercent(total ? g.correct / total : 0)})</td>
        <td class="num">${formatSeconds(g.answered_count ? g.answered_ms / g.answered_count : null)}</td>
        <td>${escapeHtml(g.status)}${g.flagged ? `<br><span class="pill error" title="${escapeHtml(g.flag_reason || '')}">Marcada</span>` : ''}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" type="button" data-act="detail">Ver</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="flag">${g.flagged ? 'Desmarcar' : 'Marcar fraude'}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="delete">Eliminar</button>
        </td></tr>`;
    }).join('') || '<tr><td colspan="8" class="empty-row">Sin partidas.</td></tr>';
    $$('#g-body tr[data-id]').forEach((tr) => {
      const g = games.find((x) => x.id === tr.dataset.id);
      tr.querySelector('[data-act="detail"]').addEventListener('click', () => gameDetail(g));
      tr.querySelector('[data-act="flag"]').addEventListener('click', async () => {
        const reason = g.flagged ? null : prompt('Motivo de la moderación:', 'Puntaje sospechoso');
        if (!g.flagged && reason === null) return;
        try { must(await sb.from('games').update({ flagged: !g.flagged, flag_reason: reason }).eq('id', g.id).select()); toast('Partida actualizada.'); loadGames(); }
        catch (e) { toast(e.message, 'error'); }
      });
      tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta partida y sus respuestas?')) return;
        try { must(await sb.from('games').delete().eq('id', g.id).select()); toast('Partida eliminada.'); loadGames(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  } catch (e) { body.innerHTML = `<tr><td colspan="8" class="error-row">${escapeHtml(e.message)}</td></tr>`; }
}

async function gameDetail(g) {
  $('#g-detail-body').innerHTML = '<p class="loading-row"><span class="spinner"></span></p>';
  openDialog('g-detail');
  try {
    const rows = must(await sb.from('game_answers').select('position,question_id,choice,is_correct,elapsed_ms,points_base,points_speed,points_streak,served_at,answered_at,questions(title,is_ai)').eq('game_id', g.id).order('position'));
    $('#g-detail-body').innerHTML = `
      <p><strong>${escapeHtml(g.players?.name || '')}</strong> · ${escapeHtml(MODE_LABELS[g.mode])} · ${formatNumber(g.score)} puntos ${g.flag_reason ? `· ⚠️ ${escapeHtml(g.flag_reason)}` : ''}</p>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Imagen</th><th>Era</th><th>Respondió</th><th class="num">Tiempo</th><th class="num">Puntos</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.position}</td><td>${escapeHtml(r.questions?.title || r.question_id || '(eliminada)')}</td>
        <td>${r.questions ? (r.questions.is_ai ? 'IA' : 'Real') : '—'}</td>
        <td>${r.choice ? (r.choice === 'ai' ? 'IA' : 'Real') : '—'} ${r.is_correct === true ? '✅' : r.is_correct === false ? '❌' : '⏱️'}</td>
        <td class="num">${formatSeconds(r.elapsed_ms)}</td><td class="num">${r.points_base + r.points_speed + r.points_streak}</td></tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) { $('#g-detail-body').innerHTML = `<p class="error-box">${escapeHtml(e.message)}</p>`; }
}

/* ---------------- Estadísticas ---------------- */

async function loadAdminStats() {
  try {
    const r = must(await sb.rpc('admin_stats'));
    $('#admin-kpis').innerHTML = [
      ['Partidas totales (incl. abandonadas)', r.all_games], ['Partidas abandonadas', r.abandoned_games],
      ['Partidas marcadas', r.flagged_games], ['Jugadores registrados', r.players_registered],
      ['Jugadores suspendidos', r.banned_players], ['Preguntas activas / inactivas', `${r.questions_active} / ${r.questions_inactive}`],
    ].map(([k, v]) => `<div class="kpi"><span class="kpi-v">${escapeHtml(String(v))}</span><span class="kpi-k">${escapeHtml(k)}</span></div>`).join('');
    renderStats($('#stats-body'), {
      scope: 'global', totalGames: r.total_games, rankedGames: r.ranked_games, totalPlayers: r.total_players,
      avgScoreClassic: r.avg_score_classic, accuracy: r.accuracy, aiAccuracy: r.ai_accuracy, realAccuracy: r.real_accuracy,
      distribution: r.distribution, categories: r.categories, timeline: r.timeline,
      hardest: (r.hardest || []).map((h) => ({ ...h, image_url: resolveImageUrl(h.image_url), errorRate: Number(h.error_rate) })),
    });
    $('#perq-body').innerHTML = (r.per_question || []).map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${p.is_ai ? 'IA' : 'Real'}</td><td class="num">${p.answers}</td><td class="num">${p.answers ? formatPercent(Number(p.error_rate)) : '—'}</td></tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

init().catch((e) => { console.error(e); toast(e.message || 'Error al iniciar el panel.', 'error'); });
