-- Cadencia — initial schema. Run this once in the Supabase SQL editor on a
-- fresh project before deploying. Idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ─── athletes ──────────────────────────────────────────────────────────────
-- Fixed roster of two: Juan and José. `auth_user_id` links a row to a real
-- Supabase Auth user once that user is created (see CLAUDE.md — this app
-- has no self-signup; the two accounts are created by hand once).
create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('juan', 'jose')),
  name text not null,
  initials text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
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

insert into athletes (slug, name, initials)
values
  ('juan', 'Juan', 'JB'),
  ('jose', 'José Miguel', 'JE')
on conflict (slug) do nothing;

-- ─── workouts ──────────────────────────────────────────────────────────────
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race')),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workouts_athlete_date_idx on workouts (athlete_id, date);

-- ─── templates ─────────────────────────────────────────────────────────────
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race')),
  title text not null,
  minutes integer not null default 0,
  km numeric(6,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now()
);

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
-- This is a shared, two-person coach log, not a siloed multi-tenant app:
-- any visitor can read and write both athletes' workouts/templates — the
-- "who" switch in the UI is a view filter, not a security boundary.
--
-- Auth is deliberately NOT required right now (explicit product decision,
-- Oct 2026 — "quita el tema de la autenticacion por el momento, no
-- necesitamos claves ahorita"): policies below grant `anon` the same access
-- as `authenticated`, so the app works with nobody signed in. This is a
-- real, accepted tradeoff — anyone with the deployed URL can read and write
-- every workout/template — acceptable only because this app isn't publicly
-- shared or indexed. strava_connections stays locked to service-role only
-- regardless (real OAuth tokens), unaffected by this decision. Revisit
-- before sharing the URL beyond Juan and José, or re-enable Supabase Auth
-- (the `auth_user_id` column and the `/auth` sign-in page both still exist
-- in git history) and narrow these policies back to `authenticated` only.

alter table athletes enable row level security;
drop policy if exists athletes_select_authenticated on athletes;
drop policy if exists athletes_select_public on athletes;
create policy athletes_select_public on athletes
  for select to anon, authenticated using (true);

alter table workouts enable row level security;
drop policy if exists workouts_all_authenticated on workouts;
drop policy if exists workouts_all_public on workouts;
create policy workouts_all_public on workouts
  for all to anon, authenticated using (true) with check (true);

alter table templates enable row level security;
drop policy if exists templates_all_authenticated on templates;
drop policy if exists templates_all_public on templates;
create policy templates_all_public on templates
  for all to anon, authenticated using (true) with check (true);

alter table strava_activities enable row level security;
drop policy if exists strava_activities_select_authenticated on strava_activities;
drop policy if exists strava_activities_select_public on strava_activities;
create policy strava_activities_select_public on strava_activities
  for select to anon, authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route.

alter table strava_connections enable row level security;
-- Deliberately no policies at all — service-role only, with or without auth.
