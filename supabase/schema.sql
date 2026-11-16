-- =====================================================================
--  REAL OR AI — Esquema de base de datos para Supabase (PostgreSQL 15+)
--
--  Ejecutar completo en: Supabase → SQL Editor → New query → Run.
--  Es idempotente: se puede volver a ejecutar para actualizar funciones.
--
--  Seguridad:
--   • Todas las tablas tienen RLS activado. El rol "anon" (navegador) NO puede leer
--     ni escribir tablas directamente: solo puede llamar a las funciones RPC de juego.
--   • Las funciones de juego son SECURITY DEFINER: el servidor elige preguntas, toma
--     tiempos, corrige respuestas y calcula los puntos. El cliente nunca envía puntajes.
--   • Los administradores (tabla admins + Supabase Auth) gestionan contenido vía RLS.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  TABLAS
-- ---------------------------------------------------------------------

-- Banco de imágenes / preguntas
create table if not exists public.questions (
  id            text primary key,
  image_url     text not null,                         -- ruta relativa del sitio o URL pública de Storage
  is_ai         boolean not null,                      -- true = generada por IA, false = fotografía real
  category      text not null check (category in ('people','animals','landscapes','cities','food','sports','everyday','objects','nature','surreal')),
  difficulty    text not null check (difficulty in ('easy','medium','hard')),
  title         text not null check (char_length(title) between 3 and 140),
  context       text not null,
  explanation   text not null,
  features      text[] not null default '{}',
  tips          text[] not null default '{}',
  source        text not null,                         -- nombre de la fuente (p.ej. Wikimedia Commons)
  source_url    text,
  author        text,
  license       text not null,
  license_url   text,
  ai_tool       text,                                  -- herramienta de IA (solo si is_ai)
  storage_path  text,                                  -- ruta en Supabase Storage si se subió desde el panel
  added_at      date not null default current_date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Jugadores (identificados por apodo + dispositivo anónimo; sin email ni contraseña)
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null,
  name        text not null check (char_length(name) between 3 and 20),
  name_key    text generated always as (lower(name)) stored,
  banned      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (device_id, name_key)
);
create index if not exists players_name_key_idx on public.players (name_key);

-- Partidas
create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.players(id) on delete cascade,
  mode           text not null check (mode in ('classic','timeattack','learning')),
  difficulty     text not null check (difficulty in ('mixed','easy','medium','hard')),
  status         text not null default 'active' check (status in ('active','finished','abandoned')),
  question_ids   text[] not null,                      -- orden planificado por el servidor
  started_at     timestamptz not null default clock_timestamp(),
  finished_at    timestamptz,
  score          int not null default 0,
  correct        int not null default 0,
  wrong          int not null default 0,
  unanswered     int not null default 0,
  streak         int not null default 0,
  best_streak    int not null default 0,
  answered_ms    bigint not null default 0,            -- suma de tiempos de respuestas contestadas
  answered_count int not null default 0,
  flagged        boolean not null default false,       -- moderación: excluida del ranking
  flag_reason    text
);
create index if not exists games_rank_idx on public.games (mode, status, flagged, score desc);
create index if not exists games_player_idx on public.games (player_id, started_at desc);

-- Resultados por pregunta (una fila por imagen mostrada)
create table if not exists public.game_answers (
  id            bigint generated always as identity primary key,
  game_id       uuid not null references public.games(id) on delete cascade,
  question_id   text references public.questions(id) on delete set null,
  position      int not null,
  served_at     timestamptz not null default clock_timestamp(),
  answered_at   timestamptz,
  choice        text check (choice in ('real','ai')),  -- null = no respondida
  is_correct    boolean,
  elapsed_ms    int,
  points_base   int not null default 0,
  points_speed  int not null default 0,
  points_streak int not null default 0,
  unique (game_id, position)
);
create index if not exists game_answers_q_idx on public.game_answers (question_id);
create unique index if not exists game_answers_game_q_uidx on public.game_answers (game_id, question_id);

-- Administradores (usuarios de Supabase Auth autorizados)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  REGLAS DEL JUEGO (deben coincidir con js/scoring.js)
-- ---------------------------------------------------------------------
create or replace function public._rule(p_key text) returns int
language sql immutable as $$
  select case p_key
    when 'base' then 100
    when 'speed_bonus' then 50
    when 'classic_ms' then 15000
    when 'speed_threshold_ms' then 5000
    when 'streak3' then 50
    when 'streak5' then 100
    when 'timeattack_ms' then 60000
    when 'classic_questions' then 10
    when 'learning_questions' then 10
    when 'latency_grace_ms' then 1500   -- tolerancia de red
  end
$$;

-- ---------------------------------------------------------------------
--  UTILIDADES
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before update on public.questions
  for each row execute function public._touch_updated_at();

-- Valida el apodo: 3–20 caracteres, letras (con acentos), números, espacio . _ -
create or replace function public._valid_name(p_name text) returns text
language plpgsql immutable as $$
declare v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v) < 3 or char_length(v) > 20 then
    raise exception 'El nombre debe tener entre 3 y 20 caracteres.' using errcode = 'P0001';
  end if;
  if v !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÄËÏÖäëïöÇçÃÕãõ _.\-]+$' or v !~ '[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]' then
    raise exception 'Usá solo letras, números, espacios, puntos, guiones o guion bajo.' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- Obtiene una partida verificando que pertenezca al dispositivo (bloquea la fila).
create or replace function public._own_game(p_game uuid, p_device uuid) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  select g2.* into g from public.games g2 join public.players p on p.id = g2.player_id
   where g2.id = p_game and p.device_id = p_device
   for update of g2;
  if not found then raise exception 'Partida no encontrada.' using errcode = 'P0001'; end if;
  return g;
end $$;

-- Selección equilibrada: mitad REAL / mitad IA, categorías repartidas, prioriza no vistas,
-- y ordena evitando misma categoría consecutiva y 3 respuestas iguales seguidas.
create or replace function public._pick_questions(p_difficulty text, p_count int, p_device uuid)
returns text[] language plpgsql volatile security definer set search_path = public as $$
declare
  v_recent text[];
  v_pool_n int;
  v_ai int; v_real int; v_ai_avail int; v_real_avail int;
  v_ids text[]; v_out text[] := '{}';
  rec record; v_last_cat text; v_last_ai boolean; v_prev_ai boolean; v_found boolean; v_left text[];
begin
  -- preguntas vistas en las últimas 3 partidas del dispositivo
  select coalesce(array_agg(distinct a.question_id), '{}') into v_recent
    from public.game_answers a
   where a.game_id in (select g.id from public.games g join public.players p on p.id = g.player_id
                        where p.device_id = p_device order by g.started_at desc limit 3);

  create temporary table if not exists _pool (id text, is_ai boolean, category text, seen boolean, rnd double precision) on commit drop;
  truncate _pool;
  insert into _pool select q.id, q.is_ai, q.category, q.id = any(v_recent), random()
    from public.questions q where q.active and (p_difficulty = 'mixed' or q.difficulty = p_difficulty);
  select count(*) into v_pool_n from _pool;
  if v_pool_n < p_count then  -- la dificultad elegida no alcanza: usar todo el banco
    truncate _pool;
    insert into _pool select q.id, q.is_ai, q.category, q.id = any(v_recent), random() from public.questions q where q.active;
  end if;

  select count(*) filter (where is_ai), count(*) filter (where not is_ai) into v_ai_avail, v_real_avail from _pool;
  v_ai := p_count / 2 + (case when p_count % 2 = 1 and random() < .5 then 1 else 0 end);
  v_real := p_count - v_ai;
  if v_ai_avail < v_ai then v_real := v_real + (v_ai - v_ai_avail); v_ai := v_ai_avail; end if;
  if v_real_avail < v_real then v_ai := v_ai + (v_real - v_real_avail); v_real := v_real_avail; end if;

  -- reparto por categoría: primero una de cada categoría (no vistas primero), luego segundas, etc.
  select array_agg(id) into v_ids from (
    (select id from (select id, seen, row_number() over (partition by category order by seen, rnd) rn, random() r2
       from _pool where is_ai) s order by seen, rn, r2 limit v_ai)
    union all
    (select id from (select id, seen, row_number() over (partition by category order by seen, rnd) rn, random() r2
       from _pool where not is_ai) s order by seen, rn, r2 limit v_real)
  ) x;
  if v_ids is null then return '{}'; end if;

  -- orden final con restricciones de alternancia (codicioso aleatorio)
  v_left := v_ids;
  while array_length(v_left, 1) is not null loop
    v_found := false;
    for rec in select p.id, p.is_ai, p.category from _pool p where p.id = any(v_left) order by random() loop
      if (v_last_cat is null or rec.category <> v_last_cat)
         and not (v_last_ai is not null and v_prev_ai is not null and rec.is_ai = v_last_ai and rec.is_ai = v_prev_ai) then
        v_found := true; exit;
      end if;
    end loop;
    if not v_found then
      select p.id, p.is_ai, p.category into rec from _pool p where p.id = any(v_left) order by random() limit 1;
    end if;
    v_out := v_out || rec.id;
    v_left := array_remove(v_left, rec.id);
    v_prev_ai := v_last_ai; v_last_ai := rec.is_ai; v_last_cat := rec.category;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
--  RPC PÚBLICAS DEL JUEGO
-- ---------------------------------------------------------------------

-- Información del banco (para habilitar el juego)
create or replace function public.get_bank_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where active),
    'real', count(*) filter (where active and not is_ai),
    'ai', count(*) filter (where active and is_ai))
  from public.questions;
$$;

-- Inicia una partida
create or replace function public.start_game(p_device uuid, p_name text, p_mode text, p_difficulty text default 'mixed')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := public._valid_name(p_name);
  v_player public.players;
  v_ids text[];
  v_game uuid;
  v_recent_games int;
begin
  if p_device is null then raise exception 'Dispositivo inválido.' using errcode = 'P0001'; end if;
  if p_mode not in ('classic','timeattack','learning') then raise exception 'Modo de juego inválido.' using errcode = 'P0001'; end if;
  if p_difficulty not in ('mixed','easy','medium','hard') then raise exception 'Dificultad inválida.' using errcode = 'P0001'; end if;

  insert into public.players (device_id, name) values (p_device, v_name)
    on conflict (device_id, name_key) do update set name = excluded.name
    returning * into v_player;
  if v_player.banned then raise exception 'Este jugador fue suspendido por moderación.' using errcode = 'P0001'; end if;

  -- Límite anti-abuso: máximo 30 partidas por dispositivo cada 10 minutos
  select count(*) into v_recent_games from public.games g join public.players p on p.id = g.player_id
   where p.device_id = p_device and g.started_at > now() - interval '10 minutes';
  if v_recent_games >= 30 then raise exception 'Demasiadas partidas seguidas. Esperá unos minutos.' using errcode = 'P0001'; end if;

  -- Una sola partida activa por dispositivo: las anteriores quedan abandonadas
  update public.games g set status = 'abandoned', finished_at = now()
    from public.players p where p.id = g.player_id and p.device_id = p_device and g.status = 'active';

  v_ids := public._pick_questions(
    p_difficulty,
    case p_mode when 'timeattack' then 1000 when 'learning' then public._rule('learning_questions') else public._rule('classic_questions') end,
    p_device);
  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'No hay suficientes imágenes activas para jugar.' using errcode = 'P0001'; end if;

  insert into public.games (player_id, mode, difficulty, question_ids)
    values (v_player.id, p_mode, p_difficulty, v_ids) returning id into v_game;

  return jsonb_build_object(
    'game_id', v_game, 'mode', p_mode, 'difficulty', p_difficulty,
    'total', case when p_mode = 'timeattack' then null else array_length(v_ids, 1) end,
    'per_question_ms', case when p_mode = 'classic' then public._rule('classic_ms') end,
    'game_time_ms', case when p_mode = 'timeattack' then public._rule('timeattack_ms') end);
end $$;

-- Entrega la siguiente imagen (sin revelar su clasificación)
create or replace function public.next_question(p_game uuid, p_device uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public._own_game(p_game, p_device);
  a public.game_answers;
  v_pos int;
  q public.questions;
begin
  if g.status <> 'active' then raise exception 'La partida ya terminó.' using errcode = 'P0001'; end if;
  if g.mode = 'timeattack' and clock_timestamp() > g.started_at + make_interval(secs => public._rule('timeattack_ms') / 1000.0) then
    return jsonb_build_object('done', true, 'reason', 'time');
  end if;
  -- Si hay una imagen servida sin responder, se devuelve la misma (no se puede "saltar").
  select * into a from public.game_answers where game_id = g.id and answered_at is null order by position desc limit 1;
  if not found then
    select coalesce(max(position), 0) into v_pos from public.game_answers where game_id = g.id;
    if v_pos >= array_length(g.question_ids, 1) then return jsonb_build_object('done', true, 'reason', 'end'); end if;
    insert into public.game_answers (game_id, question_id, position)
      values (g.id, g.question_ids[v_pos + 1], v_pos + 1) returning * into a;
  end if;
  select * into q from public.questions where id = a.question_id;
  return jsonb_build_object(
    'done', false, 'question_id', a.question_id, 'image_url', q.image_url, 'position', a.position,
    'total', case when g.mode = 'timeattack' then null else array_length(g.question_ids, 1) end,
    'category', q.category, 'difficulty', q.difficulty);
end $$;

-- Registra la respuesta, la corrige y calcula los puntos en el servidor
create or replace function public.submit_answer(p_game uuid, p_device uuid, p_question text, p_choice text, p_client_ms int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public._own_game(p_game, p_device);
  a public.game_answers;
  q public.questions;
  v_now timestamptz := clock_timestamp();
  v_server_ms int;
  v_ms int;
  v_choice text := p_choice;
  v_correct boolean;
  v_base int := 0; v_speed int := 0; v_streak_pts int := 0;
  v_streak int;
begin
  if g.status <> 'active' then raise exception 'La partida ya terminó.' using errcode = 'P0001'; end if;
  if v_choice is not null and v_choice not in ('real','ai') then raise exception 'Respuesta inválida.' using errcode = 'P0001'; end if;

  select * into a from public.game_answers
   where game_id = g.id and question_id = p_question and answered_at is null for update;
  if not found then raise exception 'Esta pregunta ya fue respondida.' using errcode = 'P0001'; end if;

  if g.mode = 'timeattack' and v_now > g.started_at + make_interval(secs => (public._rule('timeattack_ms') + public._rule('latency_grace_ms')) / 1000.0) then
    raise exception 'Se terminó el tiempo de la partida.' using errcode = 'P0001';
  end if;

  -- Tiempo medido por el servidor. El cliente puede informar un tiempo menor (latencia),
  -- pero nunca más de 1,5 s por debajo de lo que midió el servidor.
  v_server_ms := greatest(0, (extract(epoch from (v_now - a.served_at)) * 1000)::int);
  v_ms := greatest(coalesce(p_client_ms, v_server_ms), v_server_ms - public._rule('latency_grace_ms'), 0);
  v_ms := least(v_ms, v_server_ms + 1000);

  if g.mode = 'classic' and v_ms > public._rule('classic_ms') then
    v_choice := null; -- fuera de tiempo = no respondida
  end if;

  select * into q from public.questions where id = p_question;
  v_correct := case when v_choice is null then null else (v_choice = 'ai') = q.is_ai end;

  if v_correct then
    v_streak := g.streak + 1;
    v_base := public._rule('base');
    if g.mode = 'classic' and v_ms < public._rule('speed_threshold_ms') then v_speed := public._rule('speed_bonus'); end if;
    v_streak_pts := case v_streak when 3 then public._rule('streak3') when 5 then public._rule('streak5') else 0 end;
  else
    v_streak := 0;
  end if;

  update public.game_answers set answered_at = v_now, choice = v_choice, is_correct = v_correct, elapsed_ms = v_ms,
         points_base = v_base, points_speed = v_speed, points_streak = v_streak_pts
   where id = a.id;

  update public.games set
    score = score + v_base + v_speed + v_streak_pts,
    correct = correct + (case when v_correct then 1 else 0 end),
    wrong = wrong + (case when v_correct = false then 1 else 0 end),
    unanswered = unanswered + (case when v_correct is null then 1 else 0 end),
    streak = v_streak,
    best_streak = greatest(best_streak, v_streak),
    answered_ms = answered_ms + (case when v_correct is not null then v_ms else 0 end),
    answered_count = answered_count + (case when v_correct is not null then 1 else 0 end)
   where id = g.id
   returning * into g;

  return jsonb_build_object(
    'correct', v_correct, 'is_ai', q.is_ai, 'choice', v_choice, 'elapsed_ms', v_ms,
    'points_base', v_base, 'points_speed', v_speed, 'points_streak', v_streak_pts,
    'points_total', v_base + v_speed + v_streak_pts,
    'score', g.score, 'streak', g.streak, 'best_streak', g.best_streak,
    'question', jsonb_build_object(
      'id', q.id, 'title', q.title, 'context', q.context, 'explanation', q.explanation,
      'features', to_jsonb(q.features), 'tips', to_jsonb(q.tips), 'category', q.category, 'difficulty', q.difficulty,
      'source', q.source, 'source_url', q.source_url, 'author', q.author, 'license', q.license,
      'license_url', q.license_url, 'ai_tool', q.ai_tool, 'image_url', q.image_url));
end $$;

-- Cierra la partida, aplica controles anti-trampa y devuelve el resumen
create or replace function public.finish_game(p_game uuid, p_device uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games := public._own_game(p_game, p_device);
  v_total int; v_pending int; v_rank int; v_flag boolean := false; v_reason text; v_name text;
  v_elapsed_ms bigint;
begin
  if g.status <> 'active' then raise exception 'La partida ya fue cerrada.' using errcode = 'P0001'; end if;
  select count(*) filter (where answered_at is null) into v_pending from public.game_answers where game_id = g.id;
  v_elapsed_ms := (extract(epoch from (clock_timestamp() - g.started_at)) * 1000)::bigint;

  if g.mode in ('classic','learning') then
    if v_pending > 0 or (select count(*) from public.game_answers where game_id = g.id) < array_length(g.question_ids, 1) then
      raise exception 'La partida no se completó.' using errcode = 'P0001';
    end if;
  else
    -- contrarreloj: solo se puede cerrar cuando terminó el tiempo o se agotaron las imágenes
    if v_elapsed_ms < public._rule('timeattack_ms') - public._rule('latency_grace_ms')
       and (select count(*) from public.game_answers where game_id = g.id) < array_length(g.question_ids, 1) then
      raise exception 'La partida todavía está en curso.' using errcode = 'P0001';
    end if;
    delete from public.game_answers where game_id = g.id and answered_at is null; -- la imagen en pantalla no cuenta
  end if;

  -- Controles automáticos (las partidas sospechosas quedan fuera del ranking para revisión)
  if g.answered_count >= 5 and g.answered_ms / g.answered_count < 350 then
    v_flag := true; v_reason := 'Tiempo promedio de respuesta imposible (< 0,35 s)';
  end if;

  v_total := g.correct + g.wrong + g.unanswered;
  update public.games set status = 'finished', finished_at = clock_timestamp(),
         flagged = flagged or v_flag, flag_reason = coalesce(flag_reason, v_reason)
   where id = g.id returning * into g;

  select name into v_name from public.players where id = g.player_id;
  if g.mode <> 'learning' and not g.flagged then
    select r.rank_pos into v_rank from public._ranking_rows(g.mode) r where r.player_id = g.player_id;
  end if;

  return jsonb_build_object(
    'name', v_name, 'mode', g.mode, 'score', g.score, 'correct', g.correct, 'wrong', g.wrong, 'unanswered', g.unanswered,
    'total', v_total, 'accuracy', case when v_total > 0 then round(g.correct::numeric / v_total, 4) else 0 end,
    'avg_ms', case when g.answered_count > 0 then (g.answered_ms / g.answered_count) end,
    'best_streak', g.best_streak,
    'duration_ms', (extract(epoch from (g.finished_at - g.started_at)) * 1000)::bigint,
    'ranked', g.mode <> 'learning', 'flagged', g.flagged, 'rank', v_rank);
end $$;

-- Filas de ranking: mejor partida por jugador (puntaje ↓, % aciertos ↓, tiempo promedio ↑)
create or replace function public._ranking_rows(p_mode text)
returns table (rank_pos bigint, player_id uuid, name text, score int, accuracy numeric, avg_ms bigint, date timestamptz)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (g.player_id)
      g.player_id, p.name, g.score,
      case when (g.correct + g.wrong + g.unanswered) > 0 then round(g.correct::numeric / (g.correct + g.wrong + g.unanswered), 4) else 0 end as accuracy,
      case when g.answered_count > 0 then g.answered_ms / g.answered_count else 999999 end as avg_ms,
      g.finished_at
    from public.games g join public.players p on p.id = g.player_id
    where g.mode = p_mode and g.status = 'finished' and not g.flagged and not p.banned
    order by g.player_id, g.score desc,
      (case when (g.correct + g.wrong + g.unanswered) > 0 then g.correct::numeric / (g.correct + g.wrong + g.unanswered) else 0 end) desc,
      (case when g.answered_count > 0 then g.answered_ms / g.answered_count else 999999 end) asc,
      g.finished_at asc
  )
  select row_number() over (order by score desc, accuracy desc, avg_ms asc, finished_at asc) as rank_pos,
         player_id, name, score, accuracy, avg_ms, finished_at
  from best;
$$;

-- Ranking paginado con buscador
create or replace function public.get_ranking(p_mode text default 'classic', p_search text default null, p_limit int default 10, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select * from public._ranking_rows(case when p_mode in ('classic','timeattack') then p_mode else 'classic' end)),
       f as (select * from r where p_search is null or btrim(p_search) = '' or lower(name) like '%' || lower(btrim(p_search)) || '%')
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('position', rank_pos, 'name', name, 'score', score, 'accuracy', accuracy,
                                    'avg_ms', case when avg_ms = 999999 then null else avg_ms end, 'date', date) order by rank_pos)
                      from (select * from f order by rank_pos limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) x), '[]'::jsonb));
$$;

-- Estadísticas públicas agregadas
create or replace function public.get_public_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with fin as (select g.* from public.games g join public.players p on p.id = g.player_id where g.status = 'finished' and not g.flagged and not p.banned),
       ans as (select a.*, q.is_ai, q.category from public.game_answers a join fin on fin.id = a.game_id join public.questions q on q.id = a.question_id where a.answered_at is not null),
       hard as (select q.id, q.title, q.image_url, q.is_ai, count(*) n, avg(case when a.is_correct then 0 else 1 end) err
                  from ans a join public.questions q on q.id = a.question_id group by q.id having count(*) >= 3
                  order by err desc, n desc limit 8)
  select jsonb_build_object(
    'total_games', (select count(*) from fin),
    'ranked_games', (select count(*) from fin where mode <> 'learning'),
    'total_players', (select count(distinct player_id) from fin),
    'avg_score_classic', (select round(avg(score)) from fin where mode = 'classic'),
    'accuracy', (select avg(case when is_correct then 1.0 else 0 end) from ans),
    'ai_accuracy', (select avg(case when is_correct then 1.0 else 0 end) from ans where is_ai),
    'real_accuracy', (select avg(case when is_correct then 1.0 else 0 end) from ans where not is_ai),
    'distribution', jsonb_build_object(
       'aiCorrect', (select count(*) from ans where is_ai and is_correct),
       'aiWrong', (select count(*) from ans where is_ai and is_correct = false),
       'realCorrect', (select count(*) from ans where not is_ai and is_correct),
       'realWrong', (select count(*) from ans where not is_ai and is_correct = false),
       'unanswered', (select count(*) from ans where is_correct is null)),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'accuracy', acc, 'answers', n) order by acc)
                   from (select category, avg(case when is_correct then 1.0 else 0 end) acc, count(*) n from ans group by category) c), '[]'::jsonb),
    'hardest', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'image_url', image_url, 'is_ai', is_ai, 'answers', n, 'error_rate', round(err, 4)) order by err desc, n desc) from hard), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'count', c) order by d)
                 from (select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') d, count(*) c from fin
                        where started_at > now() - interval '30 days' group by 1) t), '[]'::jsonb));
$$;

-- Créditos de las imágenes activas (sin la clasificación)
create or replace function public.get_credits() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'source', source, 'source_url', source_url,
                                               'author', author, 'license', license, 'license_url', license_url) order by title), '[]'::jsonb)
  from public.questions where active;
$$;

-- Estadísticas ampliadas para el panel (solo administradores)
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Acceso solo para administradores.' using errcode = '42501'; end if;
  select public.get_public_stats() || jsonb_build_object(
    'all_games', (select count(*) from public.games),
    'abandoned_games', (select count(*) from public.games where status = 'abandoned'),
    'flagged_games', (select count(*) from public.games where flagged),
    'players_registered', (select count(*) from public.players),
    'banned_players', (select count(*) from public.players where banned),
    'questions_active', (select count(*) from public.questions where active),
    'questions_inactive', (select count(*) from public.questions where not active),
    'per_question', coalesce((select jsonb_agg(x order by x->>'error_rate' desc) from (
        select jsonb_build_object('id', q.id, 'title', q.title, 'is_ai', q.is_ai, 'answers', count(a.*),
               'error_rate', round(avg(case when a.is_correct then 0 else 1 end), 4)) x
        from public.questions q left join public.game_answers a on a.question_id = q.id and a.answered_at is not null
        group by q.id) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
--  SEGURIDAD: RLS y permisos
-- ---------------------------------------------------------------------
alter table public.questions    enable row level security;
alter table public.players      enable row level security;
alter table public.games        enable row level security;
alter table public.game_answers enable row level security;
alter table public.admins       enable row level security;

-- Sin políticas para "anon": el navegador no accede a las tablas, solo a las RPC.
drop policy if exists questions_admin_all on public.questions;
create policy questions_admin_all on public.questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists players_admin_all on public.players;
create policy players_admin_all on public.players for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists games_admin_all on public.games;
create policy games_admin_all on public.games for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists answers_admin_all on public.game_answers;
create policy answers_admin_all on public.game_answers for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());

-- Las funciones internas no se exponen
revoke execute on function public._own_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._pick_questions(text, int, uuid) from public, anon, authenticated;
revoke execute on function public._ranking_rows(text) from public, anon, authenticated;
revoke execute on function public._valid_name(text) from public, anon, authenticated;

grant execute on function public.get_bank_info() to anon, authenticated;
grant execute on function public.start_game(uuid, text, text, text) to anon, authenticated;
grant execute on function public.next_question(uuid, uuid) to anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, text, text, int) to anon, authenticated;
grant execute on function public.finish_game(uuid, uuid) to anon, authenticated;
grant execute on function public.get_ranking(text, text, int, int) to anon, authenticated;
grant execute on function public.get_public_stats() to anon, authenticated;
grant execute on function public.get_credits() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_stats() to authenticated;

-- ---------------------------------------------------------------------
--  STORAGE: bucket público para imágenes subidas desde el panel
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('question-images', 'question-images', true)
  on conflict (id) do update set public = true;

drop policy if exists "question images public read" on storage.objects;
create policy "question images public read" on storage.objects for select
  using (bucket_id = 'question-images');
drop policy if exists "question images admin insert" on storage.objects;
create policy "question images admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_admin());
drop policy if exists "question images admin update" on storage.objects;
create policy "question images admin update" on storage.objects for update to authenticated
  using (bucket_id = 'question-images' and public.is_admin());
drop policy if exists "question images admin delete" on storage.objects;
create policy "question images admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and public.is_admin());

-- ---------------------------------------------------------------------
--  ALTA DEL PRIMER ADMINISTRADOR (ejecutar aparte, después de crear el usuario
--  en Authentication → Users → Add user):
--
--    insert into public.admins (user_id)
--    select id from auth.users where email = 'tu-correo@ejemplo.com';
-- ---------------------------------------------------------------------
