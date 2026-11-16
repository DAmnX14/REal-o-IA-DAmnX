-- Pruebas de las funciones RPC del juego sobre PostgreSQL local (con supabase_stubs.sql).
-- Uso: psql -v ON_ERROR_STOP=1 -d <db> -f tests/sql/test_rpc.sql   → debe terminar con "ALL RPC TESTS PASSED".
\set QUIET on
begin;

-- Banco de prueba: 12 IA + 12 reales en varias categorías y dificultades
delete from public.questions where id like 'test-%';
insert into public.questions (id, image_url, is_ai, category, difficulty, title, context, explanation, source, license)
select 'test-' || i, 'assets/x' || i || '.jpg', i % 2 = 0,
       (array['people','animals','landscapes','cities','food','sports','everyday','objects','nature','surreal'])[1 + (i % 10)],
       (array['easy','medium','hard'])[1 + (i % 3)],
       'Pregunta ' || i, 'ctx', 'exp', 'test', 'CC0'
from generate_series(1, 24) i;
-- Desactivar cualquier pregunta real del seed para que el test sea determinista
update public.questions set active = false where id not like 'test-%';

create temporary table _t (k text primary key, v jsonb);

-- ---------- 1. Partida clásica perfecta y rápida ----------
do $$
declare dev uuid := gen_random_uuid(); r jsonb; g uuid; q jsonb; a jsonb; v_ai boolean; i int; n_ai int := 0; last_cat text; same_cat int := 0;
begin
  r := public.start_game(dev, '  Tester   Uno ', 'classic', 'mixed');
  g := (r->>'game_id')::uuid;
  assert (r->>'total')::int = 10, 'classic total 10';
  for i in 1..10 loop
    q := public.next_question(g, dev);
    assert (q->>'done')::boolean = false, 'question available';
    assert not (q ? 'is_ai'), 'next_question must not reveal the answer';
    -- la misma llamada sin responder devuelve la misma imagen (no se puede saltar)
    assert public.next_question(g, dev)->>'question_id' = q->>'question_id', 'pending question is stable';
    select is_ai into v_ai from public.questions where id = q->>'question_id';
    if v_ai then n_ai := n_ai + 1; end if;
    if last_cat = q->>'category' then same_cat := same_cat + 1; end if;
    last_cat := q->>'category';
    a := public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 900);
    assert (a->>'correct')::boolean, 'answer should be correct';
    assert (a->>'points_speed')::int = 50, 'speed bonus expected';
    if i = 3 then assert (a->>'points_streak')::int = 50, 'streak 3 bonus'; end if;
    if i = 5 then assert (a->>'points_streak')::int = 100, 'streak 5 bonus'; end if;
    if i not in (3, 5) then assert (a->>'points_streak')::int = 0, 'no streak bonus at ' || i; end if;
    -- respuesta doble rechazada
    begin
      perform public.submit_answer(g, dev, q->>'question_id', 'ai', 900);
      assert false, 'double answer must fail';
    exception when raise_exception then null;
    end;
  end loop;
  assert n_ai = 5, 'balanced 5 AI / 5 real, got ' || n_ai;
  assert same_cat = 0, 'no consecutive same category, got ' || same_cat;
  assert (public.next_question(g, dev)->>'done')::boolean, 'done after 10';
  r := public.finish_game(g, dev);
  assert (r->>'score')::int = 1650, 'perfect score 1650, got ' || (r->>'score');
  assert (r->>'correct')::int = 10 and (r->>'wrong')::int = 0, 'counts';
  assert (r->>'rank')::int = 1, 'rank 1';
  assert r->>'name' = 'Tester Uno', 'name normalized';
  -- no se puede cerrar dos veces ni seguir jugando
  begin perform public.finish_game(g, dev); assert false, 'double finish'; exception when raise_exception then null; end;
  insert into _t values ('dev1', to_jsonb(dev));
  raise notice 'OK 1 partida clásica perfecta (1650 pts, 5/5, sin categorías consecutivas)';
end $$;

-- ---------- 2. Errores, tiempo agotado y manipulación de tiempo ----------
do $$
declare dev uuid := gen_random_uuid(); r jsonb; g uuid; q jsonb; a jsonb; v_ai boolean; i int;
begin
  r := public.start_game(dev, 'Tester Dos', 'classic', 'easy');
  g := (r->>'game_id')::uuid;
  for i in 1..10 loop
    q := public.next_question(g, dev);
    select is_ai into v_ai from public.questions where id = q->>'question_id';
    if i = 1 then
      a := public.submit_answer(g, dev, q->>'question_id', null, 15000);          -- tiempo agotado
      assert a->>'correct' is null and (a->>'points_total')::int = 0, 'timeout = unanswered';
    elsif i = 2 then
      a := public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'real' else 'ai' end, 2000);  -- incorrecta
      assert (a->>'correct')::boolean = false and (a->>'points_total')::int = 0, 'wrong = 0';
    elsif i = 3 then
      -- el servidor sirvió la imagen hace 17 s pero el cliente dice que tardó 0,9 s
      update public.game_answers set served_at = served_at - interval '17 seconds' where game_id = g and answered_at is null;
      a := public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 900);
      assert a->>'correct' is null, 'server-measured > 15s counts as unanswered even if client lies';
      assert (a->>'elapsed_ms')::int >= 15000, 'elapsed corrected by server';
    elsif i = 4 then
      update public.game_answers set served_at = served_at - interval '7 seconds' where game_id = g and answered_at is null;
      a := public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 7000);  -- correcta lenta
      assert (a->>'points_total')::int = 100, 'slow correct = 100 (no speed bonus), got ' || (a->>'points_total');
    else
      a := public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 1000);
    end if;
    begin perform public.submit_answer(g, dev, 'test-999', 'ai', 100); assert false; exception when raise_exception then null; end;
  end loop;
  r := public.finish_game(g, dev);
  -- 7 correctas: i=4 (100, racha 1), i=5..10 (150 c/u, rachas 2..7 → bonus en 3 y 5)
  assert (r->>'correct')::int = 7 and (r->>'wrong')::int = 1 and (r->>'unanswered')::int = 2, 'counts mixed: ' || r::text;
  assert (r->>'score')::int = 100 + 6 * 150 + 50 + 100, 'mixed score 1150, got ' || (r->>'score');
  assert (r->>'best_streak')::int = 7, 'best streak 7';
  assert (r->>'rank')::int = 2, 'rank 2, got ' || coalesce(r->>'rank', 'null');
  raise notice 'OK 2 tiempo agotado, errores, tiempo manipulado y bonus por racha';
end $$;

-- ---------- 3. Seguridad: dispositivo ajeno, nombre inválido, modo inválido ----------
do $$
declare dev uuid := gen_random_uuid(); r jsonb; g uuid;
begin
  r := public.start_game(dev, 'Tester Tres', 'classic', 'hard');
  g := (r->>'game_id')::uuid;
  begin perform public.next_question(g, gen_random_uuid()); assert false, 'foreign device'; exception when raise_exception then null; end;
  begin perform public.start_game(dev, 'ab', 'classic', 'mixed'); assert false, 'short name'; exception when raise_exception then null; end;
  begin perform public.start_game(dev, '<script>x', 'classic', 'mixed'); assert false, 'bad chars'; exception when raise_exception then null; end;
  begin perform public.start_game(dev, 'Nombre Valido', 'hack', 'mixed'); assert false, 'bad mode'; exception when raise_exception then null; end;
  begin perform public.finish_game(g, dev); assert false, 'incomplete finish'; exception when raise_exception then null; end;
  -- iniciar otra partida abandona la anterior
  perform public.start_game(dev, 'Tester Tres', 'classic', 'mixed');
  assert (select status from public.games where id = g) = 'abandoned', 'previous game abandoned';
  perform public.start_game(dev, 'Ñandú Pérez', 'learning', 'mixed');
  raise notice 'OK 3 validaciones de seguridad';
end $$;

-- ---------- 4. Contrarreloj ----------
do $$
declare dev uuid := gen_random_uuid(); r jsonb; g uuid; q jsonb; v_ai boolean; i int;
begin
  r := public.start_game(dev, 'Tester Cuatro', 'timeattack', 'mixed');
  g := (r->>'game_id')::uuid;
  assert r->>'total' is null and (r->>'game_time_ms')::int = 60000, 'timeattack info';
  for i in 1..4 loop
    q := public.next_question(g, dev);
    select is_ai into v_ai from public.questions where id = q->>'question_id';
    perform public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 800);
  end loop;
  q := public.next_question(g, dev); -- imagen en pantalla cuando termina el tiempo
  begin perform public.finish_game(g, dev); assert false, 'cannot finish before 60s'; exception when raise_exception then null; end;
  -- simular que pasaron 63 s (más que 60 s + 1,5 s de tolerancia)
  update public.games set started_at = started_at - interval '63 seconds' where id = g;
  assert (public.next_question(g, dev)->>'done')::boolean, 'time over => done';
  begin perform public.submit_answer(g, dev, q->>'question_id', 'ai', 500); assert false, 'late answer'; exception when raise_exception then null; end;
  r := public.finish_game(g, dev);
  assert (r->>'correct')::int = 4 and (r->>'total')::int = 4, 'pending removed: ' || r::text;
  assert (r->>'score')::int = 400 + 50, 'timeattack: no speed bonus, streak3 bonus => 450, got ' || (r->>'score');
  raise notice 'OK 4 contrarreloj (60 s, sin bonus de rapidez, imagen pendiente descartada)';
end $$;

-- ---------- 5. Bot sospechoso queda marcado y fuera del ranking ----------
do $$
declare dev uuid := gen_random_uuid(); r jsonb; g uuid; q jsonb; v_ai boolean; i int;
begin
  r := public.start_game(dev, 'Bot Rapido', 'classic', 'mixed');
  g := (r->>'game_id')::uuid;
  for i in 1..10 loop
    q := public.next_question(g, dev);
    select is_ai into v_ai from public.questions where id = q->>'question_id';
    perform public.submit_answer(g, dev, q->>'question_id', case when v_ai then 'ai' else 'real' end, 10);
  end loop;
  r := public.finish_game(g, dev);
  assert (r->>'flagged')::boolean, 'bot flagged';
  assert r->>'rank' is null, 'flagged not ranked';
  raise notice 'OK 5 detección de respuestas imposibles';
end $$;

-- ---------- 6. Ranking, búsqueda, paginación, estadísticas ----------
do $$
declare r jsonb;
begin
  r := public.get_ranking('classic', null, 10, 0);
  assert (r->>'total')::int = 2, 'two ranked classic players, got ' || (r->>'total');
  assert r->'rows'->0->>'name' = 'Tester Uno' and (r->'rows'->0->>'position')::int = 1, 'order';
  r := public.get_ranking('classic', 'dos', 10, 0);
  assert (r->>'total')::int = 1 and (r->'rows'->0->>'position')::int = 2, 'search keeps real position';
  r := public.get_ranking('classic', null, 1, 1);
  assert jsonb_array_length(r->'rows') = 1 and r->'rows'->0->>'name' = 'Tester Dos', 'pagination';
  r := public.get_ranking('timeattack', null, 10, 0);
  assert (r->>'total')::int = 1, 'timeattack ranking';
  r := public.get_public_stats();
  assert (r->>'total_games')::int = 3, 'stats exclude flagged/abandoned/active, got ' || (r->>'total_games');
  assert (r->'distribution'->>'unanswered')::int = 2, 'distribution unanswered';
  assert jsonb_array_length(public.get_credits()) = 24, 'credits';
  raise notice 'OK 6 ranking (orden, búsqueda, paginación) y estadísticas';
end $$;

-- ---------- 7. Permisos del rol anon ----------
set local role anon;
do $$
declare n int; ok boolean := false;
begin
  begin select count(*) into n from public.questions; exception when insufficient_privilege then ok := true; end;
  if not ok then assert n = 0, 'anon must not read questions (RLS), got ' || n; end if;
  ok := false;
  begin insert into public.games (player_id, mode, difficulty, question_ids) values (gen_random_uuid(), 'classic', 'mixed', '{}'); exception when others then ok := true; end;
  assert ok, 'anon must not insert games';
  ok := false;
  begin update public.games set score = 999999; get diagnostics n = row_count; if n = 0 then ok := true; end if; exception when others then ok := true; end;
  assert ok, 'anon must not update scores';
  ok := false;
  begin perform public._pick_questions('mixed', 10, gen_random_uuid()); exception when insufficient_privilege then ok := true; end;
  assert ok, 'internal function must not be callable by anon';
  ok := false;
  begin perform public.admin_stats(); exception when others then ok := true; end;
  assert ok, 'admin_stats requires admin';
  -- pero sí puede jugar
  perform public.start_game(gen_random_uuid(), 'Anon Player', 'classic', 'mixed');
  perform public.get_ranking('classic', null, 10, 0);
  raise notice 'OK 7 permisos: anon solo puede usar las RPC';
end $$;
reset role;

-- ---------- 8. Administrador ----------
do $$
declare uid uuid;
begin
  insert into auth.users (email) values ('admin@test.local') returning id into uid;
  insert into public.admins (user_id) values (uid);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end $$;
set local role authenticated;
do $$
declare n int;
begin
  assert public.is_admin(), 'is admin';
  select count(*) into n from public.questions;
  assert n >= 24, 'admin reads questions';
  update public.questions set active = false where id = 'test-1';
  assert (public.admin_stats()->>'questions_inactive')::int >= 1, 'admin stats';
  raise notice 'OK 8 administrador: lectura, edición y estadísticas';
end $$;
reset role;

rollback;
\echo ALL RPC TESTS PASSED
