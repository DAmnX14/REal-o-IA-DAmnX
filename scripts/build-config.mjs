#!/usr/bin/env node
/**
 * Genera js/config.js a partir de variables de entorno (para Vercel / Netlify / CI).
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node scripts/build-config.mjs
 * Solo se aceptan la URL del proyecto y la clave pública "anon". Se rechaza la clave service_role.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const fallback = process.env.OFFLINE_FALLBACK !== 'false';

if (url && !/^https:\/\/[a-z0-9.-]+$/i.test(url.replace(/\/$/, ''))) {
  console.error('SUPABASE_URL inválida (debe ser https://<proyecto>.supabase.co).');
  process.exit(1);
}
if (key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role && payload.role !== 'anon') {
      console.error(`La clave tiene rol "${payload.role}". Usá SOLO la clave pública "anon" (nunca service_role).`);
      process.exit(1);
    }
  } catch { /* claves nuevas sb_publishable_… no son JWT */ }
  if (/^sb_secret_/.test(key)) { console.error('Esa es una clave secreta. Usá la clave publicable/anon.'); process.exit(1); }
}

const out = `/**
 * config.js — GENERADO por scripts/build-config.mjs. Configuración pública del frontend.
 * Contiene solo la URL del proyecto y la clave pública "anon" (protegida por RLS).
 */
export const CONFIG = {
  SUPABASE_URL: ${JSON.stringify(url.replace(/\/$/, ''))},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
  OFFLINE_FALLBACK: ${fallback},
};
`;
await writeFile(join(ROOT, 'js/config.js'), out);
console.log(url ? `js/config.js generado para ${url}` : 'js/config.js generado sin Supabase (modo local).');
