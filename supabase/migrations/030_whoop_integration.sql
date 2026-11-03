-- WHOOP integration (Nov 2026) — built from the real WHOOP Developer
-- Platform OpenAPI spec pasted verbatim into this session. See
-- src/lib/integrations/whoop.ts's own file header and CLAUDE.md's
-- "WHOOP integration" section for what's confirmed (everything here —
-- unlike Garmin's Health parser, field names are copied directly from
-- the spec, not reconstructed).

-- Real OAuth tokens — RLS enabled, no policies at all, same strictness
-- as strava_connections/garmin_dev_connections/coros_connections.
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

-- One row per WHOOP physiological cycle (roughly one per day).
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
alter table whoop_sleep enable row level security;
alter table whoop_recovery enable row level security;
alter table whoop_workouts enable row level security;

-- Readable by any signed-in athlete (same "shared coach log" openness
-- strava_activities already has), written only by the service-role
-- sync route.
-- Found live (Nov 2026, full codebase audit): same missing idempotency
-- guard as migration 029 — see its own comment for the full rationale.
drop policy if exists whoop_cycles_select on whoop_cycles;
create policy whoop_cycles_select on whoop_cycles for select to authenticated using (true);
drop policy if exists whoop_sleep_select on whoop_sleep;
create policy whoop_sleep_select on whoop_sleep for select to authenticated using (true);
drop policy if exists whoop_recovery_select on whoop_recovery;
create policy whoop_recovery_select on whoop_recovery for select to authenticated using (true);
drop policy if exists whoop_workouts_select on whoop_workouts;
create policy whoop_workouts_select on whoop_workouts for select to authenticated using (true);

-- Body measurement, from GET /v2/user/measurement/body — latest value
-- only, same reasoning strava_weight_kg/garmin_vo2max use for other
-- device/platform-sourced athlete-level fields.
alter table athletes add column if not exists whoop_height_m numeric;
alter table athletes add column if not exists whoop_weight_kg numeric;
alter table athletes add column if not exists whoop_max_hr integer;
alter table athletes add column if not exists whoop_profile_synced_at timestamptz;
