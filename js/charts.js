/**
 * charts.js — Mini librería de gráficos SVG interactivos (sin dependencias).
 * Barras horizontales, anillo (dona) y línea temporal, con tooltip al pasar el mouse
 * o tocar, y tabla accesible equivalente para lectores de pantalla.
 *
 * Paleta validada para fondo oscuro (contraste ≥ 3:1 y separación para daltonismo):
 *   REAL = aqua #199e70 · IA = violeta #9085e9 · magnitud = azul #3987e5
 */
import { escapeHtml } from './utils.js';

export const COLORS = {
  real: '#199e70',
  ai: '#9085e9',
  magnitude: '#3987e5',
  good: '#0ca30c',
  bad: '#e66767',
  neutral: '#6b7394',
  categorical: ['#3987e5', '#d95926', '#199e70', '#c98500'],
};

let tooltip;
function tip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'status');
    document.body.append(tooltip);
  }
  return tooltip;
}
function showTip(evt, html) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add('visible');
  const p = evt.touches?.[0] || evt;
  const x = Math.min(p.clientX + 14, innerWidth - t.offsetWidth - 8);
  const y = Math.max(8, p.clientY - t.offsetHeight - 12);
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
function hideTip() { tooltip?.classList.remove('visible'); }

function bindHover(node, html) {
  node.addEventListener('mousemove', (e) => showTip(e, html));
  node.addEventListener('mouseleave', hideTip);
  node.addEventListener('touchstart', (e) => showTip(e, html), { passive: true });
  node.addEventListener('focus', () => {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.top }, html);
  });
  node.addEventListener('blur', hideTip);
  node.setAttribute('tabindex', '0');
}

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function tableFallback(caption, headers, rows) {
  return `<table class="sr-only"><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function empty(container, msg = 'Todavía no hay datos suficientes.') {
  container.innerHTML = `<p class="chart-empty">${escapeHtml(msg)}</p>`;
}

/**
 * Barras horizontales.
 * data: [{ label, value, color?, display? , tooltip? }]
 */
export function barChart(container, data, { max = null, format = (v) => v, caption = '' } = {}) {
  if (!data.length) return empty(container);
  const m = max ?? Math.max(...data.map((d) => d.value), 1);
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'hbar-chart';
  for (const d of data) {
    const row = document.createElement('div');
    row.className = 'hbar-row';
    const pct = Math.max(0, Math.min(1, d.value / m)) * 100;
    row.innerHTML = `
      <span class="hbar-label">${escapeHtml(d.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${pct}%;background:${d.color || COLORS.magnitude}"></span></span>
      <span class="hbar-value">${escapeHtml(d.display ?? format(d.value))}</span>`;
    bindHover(row, d.tooltip || `<strong>${escapeHtml(d.label)}</strong><br>${escapeHtml(d.display ?? format(d.value))}`);
    list.append(row);
  }
  container.append(list);
  container.insertAdjacentHTML('beforeend', tableFallback(caption, ['Elemento', 'Valor'], data.map((d) => [d.label, d.display ?? format(d.value)])));
}

/**
 * Anillo (dona) con leyenda y etiquetas directas.
 * data: [{ label, value, color }]
 */
export function donutChart(container, data, { caption = '', centerLabel = '' } = {}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return empty(container);
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  const size = 180, r = 70, sw = 26, C = 2 * Math.PI * r;
  const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut', role: 'img', 'aria-label': caption });
  s.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': sw }));
  let offset = 0;
  const gap = data.filter((d) => d.value).length > 1 ? 2 : 0;
  for (const d of data) {
    if (!d.value) continue;
    const len = (d.value / total) * C;
    const seg = svg('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: d.color, 'stroke-width': sw,
      'stroke-dasharray': `${Math.max(0, len - gap)} ${C}`, 'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'donut-seg',
    });
    bindHover(seg, `<strong>${escapeHtml(d.label)}</strong><br>${d.value.toLocaleString('es-AR')} (${Math.round((d.value / total) * 100)} %)`);
    s.append(seg);
    offset += len;
  }
  const t = svg('text', { x: size / 2, y: size / 2 - 4, 'text-anchor': 'middle', class: 'donut-total' });
  t.textContent = total.toLocaleString('es-AR');
  const t2 = svg('text', { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', class: 'donut-sub' });
  t2.textContent = centerLabel;
  s.append(t, t2);
  wrap.append(s);
  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  legend.innerHTML = data.map((d) => `<li><span class="swatch" style="background:${d.color}"></span>${escapeHtml(d.label)} <strong>${Math.round((d.value / total) * 100)} %</strong></li>`).join('');
  wrap.append(legend);
  container.append(wrap);
  container.insertAdjacentHTML('beforeend', tableFallback(caption, ['Categoría', 'Cantidad'], data.map((d) => [d.label, d.value])));
}

/**
 * Línea temporal con área y crosshair.
 * points: [{ label, value }]
 */
export function lineChart(container, points, { caption = '', format = (v) => v } = {}) {
  if (!points.length) return empty(container);
  container.innerHTML = '';
  const W = 640, H = 220, P = { l: 36, r: 12, t: 14, b: 28 };
  // Escala con marcas enteras "redondas" (los conteos son números enteros)
  const rawMax = Math.max(...points.map((p) => p.value), 1);
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const max = step * Math.ceil(rawMax / step);
  const x = (i) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i / (points.length - 1)) * (W - P.l - P.r));
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'line-chart', role: 'img', 'aria-label': caption, preserveAspectRatio: 'none' });
  for (let v = 0; v <= max; v += step) {
    s.append(svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
    const lbl = svg('text', { x: P.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' });
    lbl.textContent = Math.round(v);
    s.append(lbl);
  }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  s.append(svg('path', { d: `${d} L${x(points.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`, class: 'area' }));
  s.append(svg('path', { d, class: 'line' }));
  if (points.length <= 31) points.forEach((p, i) => s.append(svg('circle', { cx: x(i), cy: y(p.value), r: 4, class: 'dot static' })));
  const labelStep = Math.ceil(points.length / 6);
  points.forEach((p, i) => {
    if (i % labelStep === 0 || i === points.length - 1) {
      const t = svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' });
      t.textContent = p.label;
      s.append(t);
    }
  });
  const cross = svg('line', { y1: P.t, y2: H - P.b, class: 'crosshair', visibility: 'hidden' });
  const dot = svg('circle', { r: 5, class: 'dot', visibility: 'hidden' });
  s.append(cross, dot);
  const hit = svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  const onMove = (e) => {
    const pt = e.touches?.[0] || e;
    const rect = s.getBoundingClientRect();
    const rx = ((pt.clientX - rect.left) / rect.width) * W;
    let i = Math.round(((rx - P.l) / (W - P.l - P.r)) * (points.length - 1));
    i = Math.max(0, Math.min(points.length - 1, i));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(points[i].value)); dot.setAttribute('visibility', 'visible');
    showTip(pt, `<strong>${escapeHtml(points[i].label)}</strong><br>${escapeHtml(format(points[i].value))}`);
  };
  hit.addEventListener('mousemove', onMove);
  hit.addEventListener('touchmove', onMove, { passive: true });
  hit.addEventListener('touchstart', onMove, { passive: true });
  hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  s.append(hit);
  container.append(s);
  container.insertAdjacentHTML('beforeend', tableFallback(caption, ['Fecha', 'Valor'], points.map((p) => [p.label, format(p.value)])));
}
