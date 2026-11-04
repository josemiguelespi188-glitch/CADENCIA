-- Cadencia — initial schema. Run this once in the Supabase SQL editor on a
-- fresh project before deploying. Idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ─── athletes ──────────────────────────────────────────────────────────────
-- A dynamic roster, not a fixed pair (see migration 013) — new athletes
-- are created only through /admin's invite flow (service-role, no
-- self-signup). `auth_user_id` links a row to a real Supabase Auth user
-- once invited and accepted. `slug` still exists as a short identifier
-- (used in URLs/exports before this migration) but is no longer
-- constrained to a fixed allow-list.
create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  initials text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique,
  -- Can reach /admin — only ever set server-side via the service-role
  -- admin API; see the athletes_guard_is_admin trigger below.
  is_admin boolean not null default false,
  -- Training-zone thresholds, editable from /settings — see migration 003
  -- and CLAUDE.md's roadmap (these feed future AI plan generation / a
  -- virtual coach agent, neither built yet).
  threshold_hr integer,
  threshold_pace_sec_per_km integer,
  ftp_watts integer,
  vo2max numeric(4,1),
  -- Real zones as configured in Strava itself, pulled on sync — see
  -- migration 005.
  strava_hr_zones jsonb,
  strava_power_zones jsonb,
  strava_zones_synced_at timestamptz,
  -- Athlete-level Strava data (not per-activity) — see migration 009.
  strava_weight_kg numeric(5,1),
  strava_stats jsonb,
  strava_profile_synced_at timestamptz,
  -- Raw shoes+bikes list from Strava, kept for reference — see migration 010.
  strava_gear jsonb,
  -- Comprehensive athlete profile (personal info, goal race, resting/max
  -- HR, personal bests) — see migration 011 and lib/racePredictor.ts.
  birth_date date,
  sex text check (sex is null or sex in ('male', 'female', 'other')),
  height_cm numeric,
  weight_kg numeric,
  resting_hr integer,
  max_hr integer,
  goal_race_name text,
  goal_race_date date,
  goal_distance text,
  goal_notes text,
  personal_bests jsonb not null default '[]'::jsonb,
  -- Device-measured, from the Garmin Developer Program's "user-metrics"
  -- push — distinct from the manually-entered vo2max above. See
  -- migration 029 and lib/integrations/garminHealthParse.ts.
  garmin_vo2max numeric,
  garmin_vo2max_cycling numeric,
  garmin_fitness_age integer,
  garmin_health_synced_at timestamptz,
  -- From WHOOP's GET /v2/user/measurement/body — see migration 030 and
  -- lib/integrations/whoop.ts.
  whoop_height_m numeric,
  whoop_weight_kg numeric,
  whoop_max_hr integer,
  whoop_profile_synced_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column athletes.threshold_hr is 'Lactate threshold heart rate (LTHR), in bpm.';
comment on column athletes.threshold_pace_sec_per_km is 'Running threshold pace ("race predictor"), in seconds per km.';
comment on column athletes.ftp_watts is 'Cycling functional threshold power (FTP), in watts.';
comment on column athletes.vo2max is 'VO2max, in ml/kg/min.';
comment on column athletes.strava_hr_zones is 'Raw heart_rate.zones array from Strava''s GET /athlete/zones, when configured there. Null if none.';
comment on column athletes.strava_power_zones is 'Raw power.zones array from Strava''s GET /athlete/zones, when configured there. Null if none.';
comment on column athletes.strava_weight_kg is 'Weight in kg, from Strava''s GET /athlete (only present if the athlete set it there).';
comment on column athletes.strava_stats is 'Raw response from Strava''s GET /athletes/{id}/stats — recent (4wk) / YTD / all-time totals per sport.';
comment on column athletes.strava_gear is 'Raw shoes + bikes list from Strava''s GET /athlete.';
comment on column athletes.weight_kg is 'Manually entered body weight (kg) — distinct from strava_weight_kg.';
comment on column athletes.resting_hr is 'Resting heart rate (bpm), self-reported.';
comment on column athletes.max_hr is 'Max heart rate (bpm), self-reported or from a field test.';
comment on column athletes.personal_bests is 'Array of {id, sport, distanceLabel, distanceMeters, timeSec, date, raceName} — see src/lib/racePredictor.ts.';
comment on column athletes.email is 'Login email — set at invite time.';
comment on column athletes.is_admin is 'Can reach /admin. Only ever changed server-side — see athletes_guard_is_admin below.';

insert into athletes (slug, name, initials, email, is_admin)
values
  ('juan', 'Juan', 'JB', null, false),
  ('jose', 'José Miguel', 'JE', 'josemiguel.espi188@gmail.com', true)
on conflict (slug) do nothing;

-- Blocks self-promotion to admin from any write path except the
-- service-role client (the admin API routes) — see migration 013.
create or replace function athletes_guard_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and new.is_admin is distinct from old.is_admin then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists athletes_guard_is_admin_trigger on athletes;
create trigger athletes_guard_is_admin_trigger
  before update on athletes
  for each row execute function athletes_guard_is_admin();

-- ─── workouts ──────────────────────────────────────────────────────────────
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race', 'brick')),
  title text not null,
  start time,
  minutes integer not null default 0,
  km numeric(6,2) not null default 0,
  notes text not null default '',
  done boolean not null default false,
  strava_activity_id text,
  -- Human-written summary used verbatim as the Strava description when
  -- matched (takes priority over the AI-generated one), and a free-text
  -- workout type/structure label. See migration 007.
  strava_comment text not null default '',
  workout_type text not null default '',
  -- Rating of Perceived Exertion, Borg CR10 (0-10) — see migration 010.
  rpe integer check (rpe is null or (rpe >= 0 and rpe <= 10)),
  -- Structured steps (warmup/work/recovery/cooldown, each with a duration
  -- + target, one level of repeat grouping) — see migration 014 and
  -- src/lib/types.ts's WorkoutStep. Empty array = no structure, notes/
  -- workout_type (free text) are unaffected either way.
  workout_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workouts_athlete_date_idx on workouts (athlete_id, date);

-- ─── templates ─────────────────────────────────────────────────────────────
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race', 'brick')),
  title text not null,
  -- Optional English companion text — see migration 032 and
  -- src/lib/templates.ts's templateTitle()/templateNotes(). Falls back
  -- to title/notes (Spanish) when unset, never a blank field.
  title_en text,
  minutes integer not null default 0,
  km numeric(6,2) not null default 0,
  notes text not null default '',
  notes_en text,
  created_at timestamptz not null default now()
);

-- Mirrors migrations 031 + 032 — seeds starting "Base workouts"
-- presets, already in their final bilingual/brick-corrected form (a
-- fresh schema.sql run doesn't need 031's original Spanish-only/
-- sport='bike' version followed by 032's corrections — it goes
-- straight to the end state).
insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Carrera larga', 'Long run', 115, 0,
  'Objetivo: desarrollar la resistencia y la base aeróbica. Calentamiento: 15 min trote. Serie principal: 80-100 min en Zona 2. Enfriamiento: 10 min trote.',
  'Goal: build endurance and aerobic base. Warmup: 15 min jog. Main set: 80-100 min in Zone 2. Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Carrera larga');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Carrera de ritmo', 'Tempo run', 60, 0,
  'Objetivo: mejorar la fuerza aeróbica y el control del ritmo. Calentamiento: 15 min trote. Serie principal: 35 min en Zona 3. Enfriamiento: 10 min trote.',
  'Goal: improve aerobic strength and pace control. Warmup: 15 min jog. Main set: 35 min in Zone 3. Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Carrera de ritmo');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Intervalos de umbral', 'Threshold intervals', 63, 0,
  'Objetivo: aumentar tu velocidad sostenible. Calentamiento: 15 min trote. Serie principal: 4 x 8 min en Zona 4 (2 min trote de recuperación entre series). Enfriamiento: 10 min trote.',
  'Goal: raise your sustainable speed. Warmup: 15 min jog. Main set: 4 x 8 min in Zone 4 (2 min jog recovery between reps). Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Intervalos de umbral');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Carrera fácil', 'Easy run', 50, 0,
  'Objetivo: promover la recuperación aeróbica y mantener el volumen estable. Calentamiento: 5 min trote. Serie principal: 40 min en Zona 1-2. Enfriamiento: 5 min trote.',
  'Goal: promote aerobic recovery and keep volume steady. Warmup: 5 min jog. Main set: 40 min in Zone 1-2. Cooldown: 5 min jog.'
where not exists (select 1 from templates where title = 'Carrera fácil');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Carrera de progresión', 'Progression run', 60, 0,
  'Objetivo: enseñar control y terminar fuerte. Calentamiento: 15 min trote. Serie principal: 15 min en Zona 2, 15 min en Zona 3, 5 min en Zona 4. Enfriamiento: 10 min trote.',
  'Goal: teach control and finish strong. Warmup: 15 min jog. Main set: 15 min Zone 2, 15 min Zone 3, 5 min Zone 4. Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Carrera de progresión');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Esfuerzos de ritmo de carrera', 'Race-pace efforts', 70, 8,
  'Objetivo: practicar el ritmo de carrera y el control del ritmo. Calentamiento: 15 min trote. Serie principal: 2 x 4 km al ritmo de carrera objetivo de Ironman 70.3 (4 min trote de recuperación entre series). Enfriamiento: 10 min trote.',
  'Goal: practice race pace and pacing control. Warmup: 15 min jog. Main set: 2 x 4 km at Ironman 70.3 goal race pace (4 min jog recovery between reps). Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Esfuerzos de ritmo de carrera');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Repeticiones de VO2 Max', 'VO2 Max repeats', 55, 0,
  'Objetivo: aumentar el techo aeróbico y la velocidad. Calentamiento: 15 min trote + zancadas. Serie principal: 5 x 3 min en Zona 5 (3 min trote de recuperación entre series). Enfriamiento: 10 min trote.',
  'Goal: raise your aerobic ceiling and speed. Warmup: 15 min jog + strides. Main set: 5 x 3 min in Zone 5 (3 min jog recovery between reps). Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Repeticiones de VO2 Max');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Conjunto de ritmo roto', 'Broken tempo set', 61, 0,
  'Objetivo: hacer que el trabajo de tempo sea más repetible y digerible. Calentamiento: 15 min trote. Serie principal: 3 x 10 min en Zona 3 (2 min trote de recuperación entre series). Enfriamiento: 10 min trote.',
  'Goal: make tempo work more repeatable and digestible. Warmup: 15 min jog. Main set: 3 x 10 min in Zone 3 (2 min jog recovery between reps). Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Conjunto de ritmo roto');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Final rápido, carrera larga', 'Fast-finish long run', 75, 0,
  'Objetivo: practicar el ritmo y los finales fuertes. Calentamiento: 10 min trote. Serie principal: 50 min en Zona 2, 15 min en Zona 3. Enfriamiento: 10 min trote.',
  'Goal: practice pacing and strong finishes. Warmup: 10 min jog. Main set: 50 min in Zone 2, 15 min in Zone 3. Cooldown: 10 min jog.'
where not exists (select 1 from templates where title = 'Final rápido, carrera larga');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'run', 'Carrera de recuperación', 'Recovery run', 40, 0,
  'Objetivo: mantenerse relajado y apoyar la adaptación. Calentamiento: 5 min trote. Serie principal: 30 min en Zona 1. Enfriamiento: 5 min trote.',
  'Goal: stay relaxed and support adaptation. Warmup: 5 min jog. Main set: 30 min in Zone 1. Cooldown: 5 min jog.'
where not exists (select 1 from templates where title = 'Carrera de recuperación');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'swim', 'Natación técnica', 'Technique swim', 0, 1.2,
  'Sesión centrada en técnica, no en velocidad. Calentamiento: 300 m en Zona 1 (estilo libre y espalda). Serie principal: 5 x (25 m piernas, 50 m técnica, 75 m natación) en Zona 1 + 20 s de descanso. Enfriamiento: 150 m tirón o natación en Zona 1. Trabaja el agarre y la recuperación del brazo.',
  'A technique-focused session, not a speed one. Warmup: 300 m in Zone 1 (freestyle and backstroke). Main set: 5 x (25 m kick, 50 m drill, 75 m swim) in Zone 1 + 20 s rest. Cooldown: 150 m pull or swim in Zone 1. Focus on catch and arm recovery.'
where not exists (select 1 from templates where title = 'Natación técnica');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'swim', 'Natación continua', 'Continuous swim', 0, 1.8,
  'Objetivo: resistencia aeróbica en el agua. Calentamiento: 300 m en Zona 1 (con algo de espalda). Bloque: 2 x 50 m piernas en Zona 1 + 10 s. Serie principal: 6 x 200 m natación o tirón en Zona 2 + 20 s. Enfriamiento: 200 m en Zona 1. Cuenta las brazadas cada tercer largo de 50 m para controlar tu técnica.',
  'Goal: aerobic endurance in the water. Warmup: 300 m in Zone 1 (with some backstroke). Block: 2 x 50 m kick in Zone 1 + 10 s. Main set: 6 x 200 m swim or pull in Zone 2 + 20 s. Cooldown: 200 m in Zone 1. Count strokes every third 50 m length to track your technique.'
where not exists (select 1 from templates where title = 'Natación continua');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'swim', 'Natación a ritmo de carrera', 'Race-pace swim', 0, 2.2,
  'Objetivo: practicar el ritmo de carrera objetivo. Calentamiento: 200 m en Zona 1 (estilo libre y espalda). Bloque: 2 x 50 m técnica en Zona 1 + 10 s. Bloque: 4 x 50 m incrementando Zona 1-Zona 4 + 15 s. Serie principal: 5 x 300 m en Zona 3 + 30 s, buscando tu velocidad de carrera objetivo. Enfriamiento: 200 m en Zona 1.',
  'Goal: practice goal race pace. Warmup: 200 m in Zone 1 (freestyle and backstroke). Block: 2 x 50 m technique in Zone 1 + 10 s. Block: 4 x 50 m building Zone 1-Zone 4 + 15 s. Main set: 5 x 300 m in Zone 3 + 30 s, aiming for your goal race pace. Cooldown: 200 m in Zone 1.'
where not exists (select 1 from templates where title = 'Natación a ritmo de carrera');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'swim', 'Natación en aguas abiertas', 'Open-water swim', 40, 0,
  'Objetivo: adaptarse al entorno de aguas abiertas antes de la carrera. Calentamiento: 5 min en Zona 1. Serie principal: 3 x 8 min en Zona 2 respirando bilateralmente, con 2 min de recuperación entre series. Enfriamiento: 5 min en Zona 1 con patada y natación suave.',
  'Goal: get comfortable in open water before race day. Warmup: 5 min in Zone 1. Main set: 3 x 8 min in Zone 2 breathing bilaterally, with 2 min recovery between reps. Cooldown: 5 min in Zone 1 with easy kick and swim.'
where not exists (select 1 from templates where title = 'Natación en aguas abiertas');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'swim', 'Natación progresiva', 'Progressive swim', 0, 2.4,
  'Objetivo: aumentar la velocidad manteniendo la técnica a medida que sube la intensidad. Calentamiento: 3 x 100 m en Zona 1 + 10 s (combinación de piernas, tirón y natación). Serie principal: 800 m en Zona 2 + 60 s, 600 m en Zona 3 + 40 s, 400 m en Zona 4. Enfriamiento: 300 m en Zona 1 (estilo libre y espalda).',
  'Goal: build speed while holding technique as intensity rises. Warmup: 3 x 100 m in Zone 1 + 10 s (mix of kick, pull and swim). Main set: 800 m in Zone 2 + 60 s, 600 m in Zone 3 + 40 s, 400 m in Zone 4. Cooldown: 300 m in Zone 1 (freestyle and backstroke).'
where not exists (select 1 from templates where title = 'Natación progresiva');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'bike', 'Bicicleta suave', 'Easy spin', 70, 0,
  'Objetivo: rodaje aeróbico suave, sin acumular fatiga. Bloque: 5 min en Zona 1 a 90 rpm. Bloque: 5 min en Zona 1 a 80 rpm. Serie principal: 55 min en Zona 1 a 90-95 rpm. Enfriamiento: 5 min muy suave. Puedes hacerlo en carretera o en rodillo/turbo.',
  'Goal: easy aerobic ride with no accumulated fatigue. Block: 5 min in Zone 1 at 90 rpm. Block: 5 min in Zone 1 at 80 rpm. Main set: 55 min in Zone 1 at 90-95 rpm. Cooldown: 5 min very easy. Road or trainer, either works.'
where not exists (select 1 from templates where title = 'Bicicleta suave');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'bike', 'Bicicleta con cuestas', 'Hill repeats', 150, 0,
  'Objetivo: fuerza y resistencia en subida. Repite 3 veces: 30 min en Zona 1 a 90 rpm + 20 min en Zona 2 a 75 rpm. Monta sobre terreno con cuestas, sin levantarte del sillín, pedaleando uniformemente para minimizar los puntos muertos.',
  'Goal: climbing strength and endurance. Repeat 3 times: 30 min in Zone 1 at 90 rpm + 20 min in Zone 2 at 75 rpm. Ride hilly terrain, stay seated on the climbs, pedal smoothly to minimize dead spots.'
where not exists (select 1 from templates where title = 'Bicicleta con cuestas');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'bike', 'Bicicleta de prueba (TT)', 'Time trial test', 60, 16,
  'Objetivo: medir tu progreso a contrarreloj. Calentamiento: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1. Serie principal: 16 km contrarreloj a la mejor marca posible, anotando tiempo y frecuencia cardíaca. Enfriamiento: 10 min en Zona 1. Usa siempre el mismo recorrido para poder comparar.',
  'Goal: measure your progress against the clock. Warmup: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1. Main set: 16 km time trial at your best effort, noting time and heart rate. Cooldown: 10 min in Zone 1. Always use the same course so you can compare.'
where not exists (select 1 from templates where title = 'Bicicleta de prueba (TT)');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'bike', 'Bicicleta fuerte (intervalos)', 'Strong intervals', 80, 0,
  'Objetivo: aumentar la capacidad de procesar oxígeno y ácido láctico. Calentamiento: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1. Serie principal: repite 5 veces (5 min en Zona 4 a 95 rpm + 5 min en Zona 1 a 85 rpm de recuperación). Enfriamiento: 10 min en Zona 1 a 90 rpm.',
  'Goal: raise your capacity to process oxygen and lactic acid. Warmup: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1. Main set: repeat 5 times (5 min in Zone 4 at 95 rpm + 5 min in Zone 1 at 85 rpm recovery). Cooldown: 10 min in Zone 1 at 90 rpm.'
where not exists (select 1 from templates where title = 'Bicicleta fuerte (intervalos)');

insert into templates (sport, title, title_en, minutes, km, notes, notes_en)
select 'brick', 'Brick bici-carrera', 'Bike-to-run brick', 85, 0,
  'Objetivo: acostumbrar las piernas a correr justo después de pedalear. Bicicleta: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1, 40 min en Zona 3 a 95 rpm, 10 min en Zona 1. Bájate de la bici y sal directo a correr: 20 min en Zona 3 + 10 min en Zona 1.',
  'Goal: get your legs used to running right off the bike. Bike: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1, 40 min in Zone 3 at 95 rpm, 10 min in Zone 1. Dismount and go straight into a run: 20 min in Zone 3 + 10 min in Zone 1.'
where not exists (select 1 from templates where title = 'Brick bici-carrera');

-- ─── strava_activities ──────────────────────────────────────────────────────
-- Cache of activities pulled from Strava's API. `id` is Strava's own
-- activity id (stored as text since it's a 64-bit int Strava may change
-- representation of). Written only by the service-role sync route.
create table if not exists strava_activities (
  id text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  name text not null default '',
  sport_type text not null default '',
  start_date timestamptz not null,
  moving_time_s integer not null default 0,
  distance_m numeric(10,1) not null default 0,
  average_cadence numeric(6,2),
  average_speed numeric(6,3),
  average_heart_rate numeric(5,1),
  raw jsonb,
  synced_at timestamptz not null default now(),
  -- Local calendar date (from Strava's start_date_local) — used to match
  -- against a planned workouts row by day, since start_date is UTC and
  -- can land on the wrong day. See migration 004 for the full rationale.
  local_date date,
  description_written_at timestamptz,
  -- Extra metrics, all extracted from `raw` at sync time — no extra API
  -- call needed. See migration 008.
  relative_effort integer,
  total_elevation_gain_m numeric(7,1),
  max_heart_rate numeric(5,1),
  average_watts numeric(6,1),
  calories numeric(7,1),
  -- Shoe/bike name, resolved from Strava's gear list at sync time — see migration 010.
  gear_name text
);

create index if not exists strava_activities_athlete_date_idx on strava_activities (athlete_id, start_date desc);
create index if not exists strava_activities_local_date_idx on strava_activities (athlete_id, local_date);

-- ─── strava_daily_load ────────────────────────────────────────────────────
-- Lightweight, summary-only training-load history (date + summed Relative
-- Effort) used only to compute CTL/ATL/TSB (Fitness/Fatigue/Form) — see
-- migration 012 and lib/fitnessForm.ts. Deliberately NOT full per-activity
-- detail like strava_activities above; a separate, further-back sync pass
-- pulls just enough to feed the Banister EWMA model.
create table if not exists strava_daily_load (
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  relative_effort numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, date)
);

create index if not exists strava_daily_load_athlete_date_idx on strava_daily_load (athlete_id, date);

-- workouts.strava_activity_id references strava_activities(id) — added as a
-- separate statement so creation order doesn't matter on a fresh run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workouts_strava_activity_id_fkey'
  ) then
    alter table workouts
      add constraint workouts_strava_activity_id_fkey
      foreign key (strava_activity_id) references strava_activities(id) on delete set null;
  end if;
end $$;

-- ─── strava_connections ─────────────────────────────────────────────────────
-- Holds real OAuth tokens. RLS enabled with NO policies at all — service-role
-- only, same strictness as every secret-holding table in the Operations Hub
-- codebase (order_tracking_links, sa_reviews, etc.). Never read or written
-- from the browser.
create table if not exists strava_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  strava_athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

-- ─── coros_connections ──────────────────────────────────────────────────────
-- Real OAuth tokens for COROS MCP (see migration 033 and CLAUDE.md's
-- "COROS MCP: real OAuth + tool discovery" section) — `coros_athlete_id`
-- is a leftover from the old, now-deleted Partner-API scaffold and stays
-- unused/null under MCP. `refresh_token` is nullable since a plain OAuth
-- 2.0 token response isn't guaranteed to include one (confirmed the hard
-- way by WHOOP's own integration — see its CLAUDE.md section).
create table if not exists coros_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  coros_athlete_id text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  -- Mirrors migration 033.
  issuer text,
  tools_catalog jsonb,
  tools_captured_at timestamptz
);

comment on column coros_connections.issuer is 'The OAuth authorization server URL discovered for this token (RFC 9728/8414) — needed to refresh against the right server later.';
comment on column coros_connections.tools_catalog is 'Raw tools/list response captured right after connecting — the real, self-describing schema for every COROS MCP tool (including the unconfirmed course object), fetched from the protocol itself rather than guessed from docs. See CLAUDE.md.';
comment on column coros_connections.tools_captured_at is 'When tools_catalog was last captured. Null until a connection has successfully listed tools at least once.';

-- ─── coros_mcp_client ────────────────────────────────────────────────────────
-- The app's own OAuth client, obtained via Dynamic Client Registration —
-- registered once for the whole app, then reused for every athlete's own
-- authorize/token requests. True-singleton pattern.
create table if not exists coros_mcp_client (
  id boolean primary key default true,
  issuer text not null,
  client_id text not null,
  client_secret text,
  client_id_issued_at timestamptz,
  authorization_endpoint text not null,
  token_endpoint text not null,
  registration_endpoint text,
  registration_response jsonb,
  created_at timestamptz not null default now(),
  constraint coros_mcp_client_singleton check (id)
);

-- ─── coros_mcp_pkce ────────────────────────────────────────────────────────────
-- Mirrors garmin_oauth_pkce — the PKCE code_verifier's round trip to
-- COROS's consent screen and back.
create table if not exists coros_mcp_pkce (
  state text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

-- ─── garmin_connections ─────────────────────────────────────────────────────
-- A long-lived self-generated Personal API key per athlete (NOT an OAuth
-- authorize/callback flow like Strava/COROS above) — see migration 015
-- and CLAUDE.md's "Garmin Personal API" section. Explicitly read-only,
-- personal-data-only per Garmin's own terms for this API tier.
create table if not exists garmin_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  personal_api_key text not null,
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

-- ─── garmin_dev_connections / garmin_push_events ────────────────────────────
-- The real Garmin Connect Developer Program (Starter Access, OAuth tier) —
-- deliberately separate from garmin_connections above. See migration 026
-- and CLAUDE.md's "Garmin Connect Developer Program" section.
create table if not exists garmin_dev_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  garmin_user_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

-- Starter Access is push-only delivery — Garmin calls a different URL
-- per data type (confirmed live, Nov 2026, via "API Tools -> Endpoint
-- Configuration": ACTIVITY - Activities, ACTIVITY - Activity Details,
-- COMMON - Deregistrations, etc., each its own registrable URL) rather
-- than one generic webhook. endpoint_type records which one a given
-- push arrived on; payload is still stored raw since the body shape
-- itself is unconfirmed.
create table if not exists garmin_push_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  endpoint_type text,
  payload jsonb not null,
  processed boolean not null default false
);

-- Garmin's OAuth 2.0 authorize step requires PKCE (confirmed live, Nov
-- 2026) — the code_verifier generated when building the authorize URL
-- has to survive the round trip to Garmin and back, stashed here keyed
-- by a random state. See migration 028.
create table if not exists garmin_oauth_pkce (
  state text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

-- ─── Garmin Health API metrics, parsed from garmin_push_events ─────────────
-- See migration 029 and lib/integrations/garminHealthParse.ts's own file
-- header for what's confirmed (object names) vs reconstructed (individual
-- field names) in the parser that fills these.
create table if not exists garmin_daily_health (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  steps integer,
  active_kilocalories integer,
  body_battery_charged integer,
  body_battery_drained integer,
  average_stress_level integer,
  max_stress_level integer,
  resting_heart_rate integer,
  average_heart_rate integer,
  max_heart_rate integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

create table if not exists garmin_sleep (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  duration_s integer,
  deep_s integer,
  light_s integer,
  rem_s integer,
  awake_s integer,
  overall_score integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

create table if not exists garmin_hrv (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  last_night_avg integer,
  last_night_5min_high integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- avg/min computed by this app from raw per-epoch readings, not a
-- Garmin-reported daily summary number — labeled that way in the UI.
create table if not exists garmin_pulse_ox (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  avg_spo2 numeric,
  min_spo2 numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

create table if not exists garmin_respiration (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  avg_breaths_per_min numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- A measurement EVENT, not a daily aggregate — append-only.
create table if not exists garmin_body_comp (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric,
  body_fat_pct numeric,
  body_water_pct numeric,
  muscle_mass_kg numeric,
  bone_mass_kg numeric,
  bmi numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists garmin_hydration (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  fluid_intake_ml integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

create table if not exists garmin_health_snapshot (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  summaries jsonb,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- ─── WHOOP integration ──────────────────────────────────────────────────────
-- See migration 030 and lib/integrations/whoop.ts's own file header —
-- built from the real WHOOP OpenAPI spec pasted verbatim into this
-- session, so (unlike the Garmin Health tables above) every field name
-- here is copied directly from the spec, not reconstructed.
create table if not exists whoop_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  whoop_user_id bigint,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

alter table whoop_connections enable row level security;
-- Deliberately no policies at all — service-role only.

create table if not exists whoop_cycles (
  athlete_id uuid not null references athletes(id) on delete cascade,
  whoop_cycle_id bigint not null,
  start_at timestamptz not null,
  end_at timestamptz,
  score_state text not null,
  strain numeric,
  kilojoule numeric,
  average_heart_rate integer,
  max_heart_rate integer,
  step_count integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, whoop_cycle_id)
);

create table if not exists whoop_sleep (
  athlete_id uuid not null references athletes(id) on delete cascade,
  whoop_sleep_id uuid not null,
  whoop_cycle_id bigint,
  start_at timestamptz not null,
  end_at timestamptz not null,
  nap boolean not null default false,
  score_state text not null,
  respiratory_rate numeric,
  sleep_performance_pct numeric,
  sleep_consistency_pct numeric,
  sleep_efficiency_pct numeric,
  total_in_bed_ms integer,
  total_awake_ms integer,
  total_light_ms integer,
  total_sws_ms integer,
  total_rem_ms integer,
  sleep_cycle_count integer,
  disturbance_count integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, whoop_sleep_id)
);

create table if not exists whoop_recovery (
  athlete_id uuid not null references athletes(id) on delete cascade,
  whoop_cycle_id bigint not null,
  whoop_sleep_id uuid,
  score_state text not null,
  recovery_score numeric,
  resting_heart_rate numeric,
  hrv_rmssd_milli numeric,
  spo2_percentage numeric,
  skin_temp_celsius numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, whoop_cycle_id)
);

create table if not exists whoop_workouts (
  athlete_id uuid not null references athletes(id) on delete cascade,
  whoop_workout_id uuid not null,
  sport_name text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  score_state text not null,
  strain numeric,
  average_heart_rate integer,
  max_heart_rate integer,
  kilojoule numeric,
  distance_meter numeric,
  altitude_gain_meter numeric,
  zone_durations jsonb,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, whoop_workout_id)
);

alter table whoop_cycles enable row level security;
drop policy if exists whoop_cycles_select on whoop_cycles;
create policy whoop_cycles_select on whoop_cycles for select to authenticated using (true);

alter table whoop_sleep enable row level security;
drop policy if exists whoop_sleep_select on whoop_sleep;
create policy whoop_sleep_select on whoop_sleep for select to authenticated using (true);

alter table whoop_recovery enable row level security;
drop policy if exists whoop_recovery_select on whoop_recovery;
create policy whoop_recovery_select on whoop_recovery for select to authenticated using (true);

alter table whoop_workouts enable row level security;
drop policy if exists whoop_workouts_select on whoop_workouts;
create policy whoop_workouts_select on whoop_workouts for select to authenticated using (true);

-- ─── updated_at trigger for workouts ────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists workouts_set_updated_at on workouts;
create trigger workouts_set_updated_at
  before update on workouts
  for each row execute function set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Real accounts again (see migration 013 — auth was briefly off, Oct
-- 2026, and came back once an admin/invite system was needed). This is
-- still a shared training log among a small, trusted, invite-only
-- roster, not a siloed multi-tenant app: any signed-in athlete can read
-- and write every OTHER athlete's workouts/templates (the "Friends"
-- picker in the UI is a view filter, not a security boundary) — being
-- invited at all is the trust boundary, not per-row ownership. The one
-- real per-row boundary is `athletes` itself: an athlete can update only
-- their own profile row, and never their own (or anyone's) `is_admin`
-- flag — see the trigger above. strava_connections stays locked to
-- service-role only regardless (real OAuth tokens).

alter table athletes enable row level security;
drop policy if exists athletes_select_authenticated on athletes;
drop policy if exists athletes_select_public on athletes;
create policy athletes_select_authenticated on athletes
  for select to authenticated using (true);

drop policy if exists athletes_update_own on athletes;
create policy athletes_update_own on athletes
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

alter table workouts enable row level security;
drop policy if exists workouts_all_public on workouts;
drop policy if exists workouts_all_authenticated on workouts;
create policy workouts_all_authenticated on workouts
  for all to authenticated using (true) with check (true);

alter table templates enable row level security;
drop policy if exists templates_all_public on templates;
drop policy if exists templates_all_authenticated on templates;
create policy templates_all_authenticated on templates
  for all to authenticated using (true) with check (true);

alter table strava_activities enable row level security;
drop policy if exists strava_activities_select_public on strava_activities;
drop policy if exists strava_activities_select_authenticated on strava_activities;
create policy strava_activities_select_authenticated on strava_activities
  for select to authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route.

alter table strava_connections enable row level security;
-- Deliberately no policies at all — service-role only.

alter table coros_connections enable row level security;
-- Deliberately no policies at all — service-role only, same as strava_connections.

alter table coros_mcp_client enable row level security;
-- Deliberately no policies at all — service-role only.

alter table coros_mcp_pkce enable row level security;
-- Deliberately no policies at all — service-role only, security-sensitive
-- for the brief OAuth round trip.

alter table garmin_connections enable row level security;
-- Deliberately no policies at all — service-role only, same as strava_connections.

alter table garmin_dev_connections enable row level security;
-- Deliberately no policies at all — service-role only, real OAuth tokens.

alter table garmin_push_events enable row level security;
-- Deliberately no policies at all — service-role only, may hold raw
-- End User health data.

alter table garmin_oauth_pkce enable row level security;
-- Deliberately no policies at all — service-role only.

-- Garmin Health metrics — readable by any signed-in athlete (same
-- "shared coach log" openness strava_activities already has), written
-- only by the service-role webhook/parser.
alter table garmin_daily_health enable row level security;
drop policy if exists garmin_daily_health_select on garmin_daily_health;
create policy garmin_daily_health_select on garmin_daily_health for select to authenticated using (true);

alter table garmin_sleep enable row level security;
drop policy if exists garmin_sleep_select on garmin_sleep;
create policy garmin_sleep_select on garmin_sleep for select to authenticated using (true);

alter table garmin_hrv enable row level security;
drop policy if exists garmin_hrv_select on garmin_hrv;
create policy garmin_hrv_select on garmin_hrv for select to authenticated using (true);

alter table garmin_pulse_ox enable row level security;
drop policy if exists garmin_pulse_ox_select on garmin_pulse_ox;
create policy garmin_pulse_ox_select on garmin_pulse_ox for select to authenticated using (true);

alter table garmin_respiration enable row level security;
drop policy if exists garmin_respiration_select on garmin_respiration;
create policy garmin_respiration_select on garmin_respiration for select to authenticated using (true);

alter table garmin_body_comp enable row level security;
drop policy if exists garmin_body_comp_select on garmin_body_comp;
create policy garmin_body_comp_select on garmin_body_comp for select to authenticated using (true);

alter table garmin_hydration enable row level security;
drop policy if exists garmin_hydration_select on garmin_hydration;
create policy garmin_hydration_select on garmin_hydration for select to authenticated using (true);

alter table garmin_health_snapshot enable row level security;
drop policy if exists garmin_health_snapshot_select on garmin_health_snapshot;
create policy garmin_health_snapshot_select on garmin_health_snapshot for select to authenticated using (true);

alter table strava_daily_load enable row level security;
drop policy if exists strava_daily_load_select_public on strava_daily_load;
drop policy if exists strava_daily_load_select_authenticated on strava_daily_load;
create policy strava_daily_load_select_authenticated on strava_daily_load
  for select to authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route.
