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
-- Mirrors strava_connections exactly — see migration 014. Prep work for the
-- "Structured Workouts and Training Plans Sync" COROS Partner API
-- capability applied for; COROS's real OAuth endpoints are unconfirmed
-- (see CLAUDE.md), so the client id/secret/base URLs are env-var-only
-- with no baked-in defaults.
create table if not exists coros_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  coros_athlete_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
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

-- Starter Access is push-only delivery — Garmin calls our webhook, we
-- store the raw payload first and parse it once its real shape is
-- confirmed against a live delivery.
create table if not exists garmin_push_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed boolean not null default false
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

alter table garmin_connections enable row level security;
-- Deliberately no policies at all — service-role only, same as strava_connections.

alter table garmin_dev_connections enable row level security;
-- Deliberately no policies at all — service-role only, real OAuth tokens.

alter table garmin_push_events enable row level security;
-- Deliberately no policies at all — service-role only, may hold raw
-- End User health data.

alter table strava_daily_load enable row level security;
drop policy if exists strava_daily_load_select_public on strava_daily_load;
drop policy if exists strava_daily_load_select_authenticated on strava_daily_load;
create policy strava_daily_load_select_authenticated on strava_daily_load
  for select to authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route.
