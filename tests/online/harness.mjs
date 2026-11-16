#!/usr/bin/env node
/**
 * Entorno de prueba "tipo Supabase" 100 % local para probar el MODO EN LÍNEA sin cuenta en la nube:
 *   PostgreSQL local  +  PostgREST (la misma API REST que usa Supabase)  +  proxy en /rest/v1
 *
 * Requisitos: PostgreSQL con supabase/schema.sql + supabase/seed.sql cargados (ver tests/README.md)
 *             y el binario de PostgREST (https://github.com/PostgREST/postgrest/releases).
 *
 * Uso:
 *   PGRST_BIN=/ruta/postgrest PG_URI="postgres://postgres@/realorai?host=/tmp&port=5433" node tests/online/harness.mjs
 *
 * Opcional, para probar el PANEL DE ADMINISTRACIÓN: ADMIN_EMAIL, ADMIN_PASSWORD y ADMIN_UID (id de auth.users
 * registrado en public.admins). El harness simula los endpoints mínimos de Supabase Auth (/auth/v1) y
 * Storage (/storage/v1, en memoria) que usa supabase-js; las políticas RLS de la base son las reales.
 * Imprime SUPABASE_URL y una clave "anon" de prueba para usar con:
 *   E2E_SUPABASE_URL=... E2E_SUPABASE_KEY=... node tests/e2e.mjs
 */
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PGRST_BIN = process.env.PGRST_BIN;
const PG_URI = process.env.PG_URI;
const PORT = Number(process.env.PORT || 54321);
const PGRST_PORT = PORT + 1;
if (!PGRST_BIN || !PG_URI) { console.error('Definí PGRST_BIN y PG_URI.'); process.exit(1); }

const secret = randomBytes(32).toString('hex');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};
const anonKey = sign({ role: 'anon', iss: 'realorai-local-test', exp: Math.floor(Date.now() / 1000) + 86400 });

const conf = join(tmpdir(), `postgrest-${process.pid}.conf`);
writeFileSync(conf, [
  `db-uri = "${PG_URI}"`, 'db-schemas = "public"', 'db-anon-role = "anon"',
  `jwt-secret = "${secret}"`, `server-port = ${PGRST_PORT}`, 'server-host = "127.0.0.1"',
].join('\n'));
const pgrst = spawn(PGRST_BIN, [conf], { stdio: ['ignore', 'inherit', 'inherit'] });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, content-profile',
};
const json = (res, code, body) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

// --- Simulación mínima de Supabase Auth ---
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, id: process.env.ADMIN_UID };
const user = () => ({ id: ADMIN.id, aud: 'authenticated', role: 'authenticated', email: ADMIN.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
async function auth(req, res, path) {
  if (path.startsWith('/token')) {
    const b = JSON.parse((await readBody(req)).toString() || '{}');
    if (!ADMIN.id || b.email !== ADMIN.email || b.password !== ADMIN.password) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = sign({ role: 'authenticated', sub: ADMIN.id, email: ADMIN.email, aud: 'authenticated', exp });
    return json(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'test-refresh', user: user() });
  }
  if (path.startsWith('/user')) return json(res, 200, user());
  if (path.startsWith('/logout')) { res.writeHead(204, cors).end(); return; }
  return json(res, 404, { msg: 'no implementado en el entorno de prueba' });
}

// --- Simulación mínima de Supabase Storage (en memoria) ---
const files = new Map();
async function storage(req, res, path) {
  const pub = path.match(/^\/object\/public\/([^/]+)\/(.+)$/);
  if (pub && req.method === 'GET') {
    const f = files.get(`${pub[1]}/${decodeURIComponent(pub[2])}`);
    if (!f) return json(res, 404, { message: 'not found' });
    res.writeHead(200, { ...cors, 'content-type': f.type }).end(f.data); return;
  }
  const up = path.match(/^\/object\/([^/]+)\/(.+)$/);
  if (up && req.method === 'POST') {
    const data = await readBody(req);
    files.set(`${up[1]}/${decodeURIComponent(up[2])}`, { data, type: req.headers['content-type'] || 'application/octet-stream' });
    return json(res, 200, { Key: `${up[1]}/${up[2]}`, Id: up[2] });
  }
  const del = path.match(/^\/object\/([^/]+)$/);
  if (del && req.method === 'DELETE') {
    const b = JSON.parse((await readBody(req)).toString() || '{}');
    for (const p of b.prefixes || []) files.delete(`${del[1]}/${p}`);
    return json(res, 200, (b.prefixes || []).map((name) => ({ name })));
  }
  return json(res, 404, { message: 'no implementado en el entorno de prueba' });
}

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  if (req.url.startsWith('/auth/v1')) { auth(req, res, req.url.slice('/auth/v1'.length)); return; }
  if (req.url.startsWith('/storage/v1')) { storage(req, res, req.url.slice('/storage/v1'.length).split('?')[0]); return; }
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(404, cors).end('{"message":"solo /rest/v1 en el entorno de prueba"}'); return; }
  const path = req.url.slice('/rest/v1'.length) || '/';
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` };
  const up = request({ host: '127.0.0.1', port: PGRST_PORT, path, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors).end(JSON.stringify({ message: String(e) })); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`SUPABASE_URL=http://127.0.0.1:${PORT}`);
  console.log(`SUPABASE_ANON_KEY=${anonKey}`);
});

process.on('SIGTERM', () => { pgrst.kill(); process.exit(0); });
process.on('SIGINT', () => { pgrst.kill(); process.exit(0); });
