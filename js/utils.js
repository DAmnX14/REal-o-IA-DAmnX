/**
 * utils.js — Funciones auxiliares compartidas (validación, sanitización, formato, DOM).
 */

/** Raíz del sitio (carpeta que contiene /js). Sirve tanto para index.html como para /admin. */
export const SITE_ROOT = new URL('../', import.meta.url);

/** Convierte una ruta de imagen del banco en URL absoluta. Las URL http(s) se dejan igual. */
export function resolveImageUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return new URL(path.replace(/^\/+/, ''), SITE_ROOT).href;
}

/* ---------------- Nombre del jugador ---------------- */

/** Letras (incluye acentos y ñ), números, espacio, guion, guion bajo y punto. */
const NAME_ALLOWED = /^[\p{L}\p{N} _.\-]+$/u;
export const NAME_MIN = 3;
export const NAME_MAX = 20;

/** Normaliza espacios del nombre (no cambia mayúsculas). */
export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Valida un nombre/apodo. Devuelve { ok, value, error }.
 * Reglas: obligatorio, 3–20 caracteres, sin caracteres peligrosos (<, >, ", ', `, {, }, etc.).
 */
export function validateName(raw) {
  const value = normalizeName(raw);
  if (!value) return { ok: false, value, error: 'Ingresá tu nombre o apodo para jugar.' };
  const len = [...value].length;
  if (len < NAME_MIN) return { ok: false, value, error: `El nombre debe tener al menos ${NAME_MIN} caracteres.` };
  if (len > NAME_MAX) return { ok: false, value, error: `El nombre puede tener como máximo ${NAME_MAX} caracteres.` };
  if (!NAME_ALLOWED.test(value)) {
    return { ok: false, value, error: 'Usá solo letras, números, espacios, puntos, guiones o guion bajo.' };
  }
  if (!/[\p{L}\p{N}]/u.test(value)) return { ok: false, value, error: 'El nombre debe contener al menos una letra o número.' };
  return { ok: true, value, error: null };
}

/** Escapa texto para insertarlo como HTML. Úsese SIEMPRE con datos externos. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
  }[c]));
}

/* ---------------- Aleatoriedad ---------------- */

/** Entero aleatorio criptográficamente fuerte en [0, max). */
export function randInt(max) {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/** Fisher–Yates (devuelve una copia mezclada). */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------- Formato ---------------- */

export function formatSeconds(ms, digits = 1) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return `${(ms / 1000).toFixed(digits).replace('.', ',')} s`;
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

export function formatPercent(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits).replace('.', ',')} %`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat('es-AR').format(n ?? 0);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ---------------- Etiquetas ---------------- */

export const CATEGORY_LABELS = {
  people: 'Personas y retratos',
  animals: 'Animales',
  landscapes: 'Paisajes',
  cities: 'Ciudades y edificios',
  food: 'Comida',
  sports: 'Deportes',
  everyday: 'Situaciones cotidianas',
  objects: 'Objetos',
  nature: 'Escenas de naturaleza',
  surreal: 'Ficticias o surrealistas',
};

export const DIFFICULTY_LABELS = { easy: 'Fácil', medium: 'Intermedio', hard: 'Difícil', mixed: 'Mixta' };
export const MODE_LABELS = { classic: 'Clásico', timeattack: 'Contrarreloj', learning: 'Aprendizaje' };

/* ---------------- DOM ---------------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento con atributos e hijos. Los strings se insertan como texto (seguro). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Precarga una imagen. Resuelve con true/false (nunca rechaza). */
export function preloadImage(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.decoding = 'async';
    img.src = url;
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
