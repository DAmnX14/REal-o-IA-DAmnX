# Pruebas de REAL OR AI

## 1. Banco de imágenes
```bash
node scripts/verify-bank.mjs
```

## 2. Unitarias (Node 18+)
```bash
node --test tests/unit.test.mjs
```

## 3. Funciones SQL del servidor (PostgreSQL 15+ local)
```bash
createdb realorai_test
psql -d realorai_test -f tests/sql/supabase_stubs.sql   # simula auth/storage/roles de Supabase
psql -d realorai_test -f supabase/schema.sql
psql -d realorai_test -v ON_ERROR_STOP=1 -f tests/sql/test_rpc.sql   # → "ALL RPC TESTS PASSED"
```
`test_rpc.sql` trabaja dentro de una transacción y hace `rollback` al final.

## 4. Navegador real (Playwright)
```bash
npm i -D playwright && npx playwright install chromium   # una sola vez
node tests/e2e.mjs                                        # modo local
```
Capturas en `tests/screenshots/`. La prueba dura ~2 minutos (incluye un contrarreloj completo de 60 s
y una espera real de 15 s para el tiempo agotado).

## 5. Modo en línea sin cuenta de Supabase
Se levanta la misma API REST que usa Supabase (PostgREST) sobre una base local:
```bash
createdb realorai_online
psql -d realorai_online -f tests/sql/supabase_stubs.sql -f supabase/schema.sql -f supabase/seed.sql
PGRST_BIN=/ruta/a/postgrest PG_URI="postgres://postgres@/realorai_online?host=/tmp" node tests/online/harness.mjs
# en otra terminal, con los valores que imprime el harness:
E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_KEY=<clave> node tests/e2e.mjs
```
En este modo la prueba verifica además que el ranking sea visible desde un segundo "dispositivo"
(contexto de navegador sin datos locales) y que el panel pida inicio de sesión.

## 6. Panel de administración (en línea)
Crear un usuario administrador en la base de prueba y levantar el harness con sus credenciales:
```bash
psql -d realorai_online -c "insert into auth.users(email) values ('admin@realorai.test') returning id"
psql -d realorai_online -c "insert into public.admins(user_id) values ('<id>')"
ADMIN_EMAIL=admin@realorai.test ADMIN_PASSWORD=<clave> ADMIN_UID=<id> PGRST_BIN=... PG_URI=... node tests/online/harness.mjs
E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_KEY=<clave anon> ADMIN_EMAIL=admin@realorai.test ADMIN_PASSWORD=<clave> node tests/e2e-admin.mjs
```
El harness simula solo los endpoints mínimos de Supabase Auth y Storage; la base de datos, PostgREST y las políticas RLS son reales.
