#!/usr/bin/env node
/**
 * Verifica el banco de imágenes ANTES de publicar:
 *  - data/questions.json válido, IDs únicos y todos los campos obligatorios.
 *  - Cada archivo existe, se puede abrir (cabecera JPEG/PNG/WebP válida) y tiene tamaño razonable.
 *  - Clasificación REAL/IA coherente con la procedencia (IA ⇒ herramienta registrada; REAL ⇒ autor).
 *  - Cantidades: 50 imágenes, 25 REAL + 25 IA; dificultades 10 / 20 / 20; equilibrio por dificultad.
 *  - Nombres de archivo neutros (no revelan la respuesta).
 * Uso: node scripts/verify-bank.mjs     (sale con código 1 si hay errores)
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED = ['id', 'file', 'classification', 'category', 'difficulty', 'title', 'context', 'explanation', 'features', 'tips', 'source', 'license', 'added_at'];
const IN_HOUSE = /^Generada para REAL OR AI/;
const CATEGORIES = ['people', 'animals', 'landscapes', 'cities', 'food', 'sports', 'everyday', 'objects', 'nature', 'surreal'];
const errors = [];
const warn = [];

function imageInfo(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: buscar marcador SOFn para leer dimensiones
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { type: 'jpeg' };
  }
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { type: 'webp' };
  return null;
}

const data = JSON.parse(await readFile(join(ROOT, 'data/questions.json'), 'utf8'));
const qs = data.questions || [];
const ids = new Set();
const files = new Set();

for (const q of qs) {
  const tag = q.id || '(sin id)';
  for (const f of REQUIRED) {
    if (q[f] == null || q[f] === '' || (Array.isArray(q[f]) && !q[f].length)) errors.push(`${tag}: falta "${f}"`);
  }
  if (ids.has(q.id)) errors.push(`${tag}: ID duplicado`);
  ids.add(q.id);
  if (files.has(q.file)) errors.push(`${tag}: archivo repetido ${q.file}`);
  files.add(q.file);
  if (!['REAL', 'IA'].includes(q.classification)) errors.push(`${tag}: clasificación inválida "${q.classification}"`);
  if (!CATEGORIES.includes(q.category)) errors.push(`${tag}: categoría inválida "${q.category}"`);
  if (!['easy', 'medium', 'hard'].includes(q.difficulty)) errors.push(`${tag}: dificultad inválida`);
  if (q.classification === 'IA' && !q.ai_tool) errors.push(`${tag}: imagen IA sin herramienta registrada`);
  if (q.classification === 'REAL' && !q.author) errors.push(`${tag}: fotografía real sin autor`);
  if (q.classification === 'REAL' && q.ai_tool) errors.push(`${tag}: fotografía real con herramienta de IA`);
  if (/\b(real|ai|ia)\b|real[_-]|[_-]ai[_.-]/i.test(q.file.split('/').pop())) errors.push(`${tag}: el nombre de archivo revela la clasificación`);
  if (!q.source_url && !IN_HOUSE.test(q.source || '')) errors.push(`${tag}: falta "source_url" (obligatorio para fuentes externas)`);
  if (q.source_url && !/^https:\/\//.test(q.source_url)) errors.push(`${tag}: source_url debe ser https`);
  if ((q.explanation || '').length < 120) warn.push(`${tag}: explicación muy corta`);
  try {
    const path = join(ROOT, q.file);
    const st = await stat(path);
    if (st.size < 20_000) errors.push(`${tag}: archivo sospechosamente pequeño (${st.size} B)`);
    if (st.size > 1_500_000) warn.push(`${tag}: archivo pesado (${Math.round(st.size / 1024)} KB)`);
    const info = imageInfo(await readFile(path));
    if (!info) errors.push(`${tag}: el archivo no es una imagen JPEG/PNG/WebP válida`);
    else if (info.width && (info.width < 600 || info.height < 400)) errors.push(`${tag}: resolución insuficiente ${info.width}x${info.height}`);
  } catch {
    errors.push(`${tag}: no existe el archivo ${q.file}`);
  }
}

const count = (fn) => qs.filter(fn).length;
const real = count((q) => q.classification === 'REAL');
const ai = count((q) => q.classification === 'IA');
const byDiff = Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, {
  total: count((q) => q.difficulty === d),
  real: count((q) => q.difficulty === d && q.classification === 'REAL'),
  ai: count((q) => q.difficulty === d && q.classification === 'IA'),
}]));
const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, count((q) => q.category === c)]));

if (qs.length !== 50) errors.push(`Se esperaban 50 imágenes y hay ${qs.length}`);
if (real !== 25 || ai !== 25) errors.push(`Se esperaban 25 REAL + 25 IA y hay ${real} + ${ai}`);
const expected = { easy: 10, medium: 20, hard: 20 };
for (const [d, n] of Object.entries(expected)) {
  if (byDiff[d].total !== n) errors.push(`Dificultad ${d}: se esperaban ${n} y hay ${byDiff[d].total}`);
  if (byDiff[d].real !== byDiff[d].ai) errors.push(`Dificultad ${d}: desequilibrio REAL ${byDiff[d].real} / IA ${byDiff[d].ai}`);
}
for (const [c, n] of Object.entries(byCat)) if (!n) errors.push(`Categoría sin imágenes: ${c}`);

console.log('REAL OR AI · Verificación del banco de imágenes');
console.log(`  Total: ${qs.length}  ·  REAL: ${real}  ·  IA: ${ai}`);
for (const [d, v] of Object.entries(byDiff)) console.log(`  ${d.padEnd(6)}: ${v.total} (REAL ${v.real} / IA ${v.ai})`);
console.log('  Categorías:', Object.entries(byCat).map(([c, n]) => `${c}=${n}`).join(', '));
for (const w of warn) console.log('  ⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`\n${errors.length} error(es). El banco NO está listo.`);
  process.exit(1);
}
console.log('\n✓ Las 50 imágenes existen, se pueden abrir y están clasificadas con procedencia registrada.');
