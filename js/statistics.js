/**
 * statistics.js — Sección pública de estadísticas con gráficos interactivos.
 * (El panel de administración reutiliza renderStats con datos ampliados.)
 */
import { $, escapeHtml, formatPercent, formatNumber, CATEGORY_LABELS } from './utils.js';
import { barChart, donutChart, lineChart, COLORS } from './charts.js';

export async function loadStats(getBackend, root = document) {
  const box = root.querySelector('#stats-body');
  box.innerHTML = '<p class="loading-row"><span class="spinner"></span> Calculando estadísticas…</p>';
  try {
    const backend = await getBackend();
    const s = await backend.getStats();
    renderStats(box, s);
  } catch (e) {
    box.innerHTML = `<p class="error-box">${escapeHtml(e.message || 'No se pudieron cargar las estadísticas.')}</p>`;
  }
}

export function renderStats(box, s) {
  const scope = s.scope === 'global'
    ? '<span class="pill online">● Datos globales de todos los jugadores</span>'
    : '<span class="pill local">● Datos de este dispositivo (modo local)</span>';
  const kpis = [
    ['Partidas realizadas', formatNumber(s.totalGames)],
    ['Jugadores registrados', formatNumber(s.totalPlayers)],
    ['Puntaje promedio (clásico)', s.avgScoreClassic == null ? '—' : formatNumber(Math.round(s.avgScoreClassic))],
    ['Respuestas correctas', formatPercent(s.accuracy)],
    ['Aciertos en imágenes IA', formatPercent(s.aiAccuracy)],
    ['Aciertos en fotos reales', formatPercent(s.realAccuracy)],
  ];
  box.innerHTML = `
    <p class="scope-line">${scope}</p>
    <div class="kpi-grid">${kpis.map(([k, v]) => `<div class="kpi"><span class="kpi-v">${v}</span><span class="kpi-k">${k}</span></div>`).join('')}</div>
    <div class="chart-grid">
      <section class="card chart-card"><h3>Distribución de respuestas</h3><div id="ch-dist"></div></section>
      <section class="card chart-card"><h3>Identificación correcta: IA vs. real</h3><div id="ch-ai-real"></div></section>
      <section class="card chart-card wide"><h3>Evolución de la participación (partidas por día)</h3><div id="ch-timeline"></div></section>
      <section class="card chart-card"><h3>Aciertos por categoría</h3><div id="ch-cats"></div></section>
      <section class="card chart-card"><h3>Preguntas con mayor porcentaje de errores</h3><div id="ch-hardest"></div></section>
    </div>
    <section class="card"><h3>Imágenes que generan mayor confusión</h3><div id="confusing" class="confusing-grid"></div></section>
  `;
  const d = s.distribution || {};
  donutChart($('#ch-dist', box), [
    { label: 'IA identificada', value: d.aiCorrect || 0, color: COLORS.ai },
    { label: 'Real identificada', value: d.realCorrect || 0, color: COLORS.real },
    { label: 'Error en IA', value: d.aiWrong || 0, color: COLORS.categorical[1] },
    { label: 'Error en real', value: d.realWrong || 0, color: COLORS.categorical[3] },
    { label: 'Sin responder', value: d.unanswered || 0, color: COLORS.neutral },
  ], { caption: 'Distribución de respuestas', centerLabel: 'respuestas' });

  barChart($('#ch-ai-real', box), [
    { label: 'Imágenes generadas por IA', value: s.aiAccuracy ?? 0, color: COLORS.ai, display: formatPercent(s.aiAccuracy) },
    { label: 'Fotografías reales', value: s.realAccuracy ?? 0, color: COLORS.real, display: formatPercent(s.realAccuracy) },
  ].filter(() => s.aiAccuracy != null || s.realAccuracy != null), { max: 1, caption: 'Porcentaje de identificación correcta' });

  lineChart($('#ch-timeline', box), (s.timeline || []).map((p) => ({ label: p.date.slice(5).split('-').reverse().join('/'), value: p.count })),
    { caption: 'Partidas por día', format: (v) => `${v} partida${v === 1 ? '' : 's'}` });

  barChart($('#ch-cats', box), (s.categories || []).map((c) => ({
    label: CATEGORY_LABELS[c.category] || c.category, value: c.accuracy, display: formatPercent(c.accuracy),
    tooltip: `<strong>${escapeHtml(CATEGORY_LABELS[c.category] || c.category)}</strong><br>${formatPercent(c.accuracy)} de aciertos en ${c.answers} respuestas`,
  })), { max: 1, caption: 'Aciertos por categoría' });

  barChart($('#ch-hardest', box), (s.hardest || []).map((h) => ({
    label: h.title, value: h.errorRate, display: formatPercent(h.errorRate), color: h.is_ai ? COLORS.ai : COLORS.real,
    tooltip: `<strong>${escapeHtml(h.title)}</strong><br>${h.is_ai ? 'Generada por IA' : 'Fotografía real'}<br>${formatPercent(h.errorRate)} de errores en ${h.answers} respuestas`,
  })), { max: 1, caption: 'Preguntas con más errores' });

  const conf = $('#confusing', box);
  const top = (s.hardest || []).slice(0, 4);
  conf.innerHTML = top.length ? top.map((h) => `
    <figure class="confusing-item">
      <img src="${escapeHtml(h.image_url)}" alt="${escapeHtml(h.title)}" loading="lazy">
      <figcaption><strong>${escapeHtml(h.title)}</strong>
        <span class="badge ${h.is_ai ? 'badge-ai' : 'badge-real'}">${h.is_ai ? 'IA' : 'REAL'}</span>
        <span>${formatPercent(h.errorRate)} de los jugadores se equivocó</span></figcaption>
    </figure>`).join('') : '<p class="chart-empty">Todavía no hay datos suficientes.</p>';
}
