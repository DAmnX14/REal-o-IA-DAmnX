#!/usr/bin/env node
/**
 * Genera supabase/seed.sql a partir de data/questions.json.
 * Uso: node scripts/build-seed.mjs
 * Luego ejecutar supabase/seed.sql en el SQL Editor de Supabase (después de schema.sql).
 * Es idempotente: actualiza las preguntas existentes con el mismo ID.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(await readFile(join(ROOT, 'data/questions.json'), 'utf8'));

const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${(a || []).map(lit).join(', ')}]::text[]`;

const rows = data.questions.map((q) => `  (${[
  lit(q.id), lit(q.file), q.classification === 'IA' ? 'true' : 'false', lit(q.category), lit(q.difficulty),
  lit(q.title), lit(q.context), lit(q.explanation), arr(q.features), arr(q.tips), lit(q.source), lit(q.source_url),
  lit(q.author), lit(q.license), lit(q.license_url), lit(q.ai_tool), `${lit(q.added_at)}::date`, q.active === false ? 'false' : 'true',
].join(', ')})`);

const sql = `-- Generado automáticamente por scripts/build-seed.mjs a partir de data/questions.json
-- ${data.questions.length} preguntas. Ejecutar DESPUÉS de supabase/schema.sql.
insert into public.questions
  (id, image_url, is_ai, category, difficulty, title, context, explanation, features, tips, source, source_url, author, license, license_url, ai_tool, added_at, active)
values
${rows.join(',\n')}
on conflict (id) do update set
  image_url = excluded.image_url, is_ai = excluded.is_ai, category = excluded.category, difficulty = excluded.difficulty,
  title = excluded.title, context = excluded.context, explanation = excluded.explanation, features = excluded.features,
  tips = excluded.tips, source = excluded.source, source_url = excluded.source_url, author = excluded.author,
  license = excluded.license, license_url = excluded.license_url, ai_tool = excluded.ai_tool, added_at = excluded.added_at;
`;
await writeFile(join(ROOT, 'supabase/seed.sql'), sql);
console.log(`supabase/seed.sql generado con ${data.questions.length} preguntas.`);
