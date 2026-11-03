-- Garmin Developer Program Health/Activity push data, parsed into real
-- queryable tables instead of only the raw garmin_push_events capture
-- (migrations 026/027). Built per explicit instruction ("con todas...
-- mejora ese dashboard") to surface every Health API metric Cadencia
-- has access to: Sleep, HRV, Body Battery + Stress + resting HR
-- (bundled together since they all live on the same Daily summary
-- object), Pulse Ox/SpO2, Respiration, Body Composition, Hydration,
-- Health Snapshot, and device-measured VO2max/Fitness Age. See
-- CLAUDE.md's "Garmin Health metrics" section for what's confirmed
-- (every field name below, from the real OpenAPI specs pasted into
-- chat) vs unconfirmed (the exact push envelope shape, since no real
-- push has landed yet — see lib/integrations/garminHealthParse.ts).
--
-- One table per pushed object type, each independently upsertable by
-- (athlete_id, calendar_date) — deliberately NOT one wide table, so
-- writing one metric type never risks nulling out a different metric
-- type's columns for the same day (a wide table would need a careful
-- partial-column upsert Supabase's client doesn't give fine control
-- over).

-- "dailies" push: steps, Body Battery, Stress, and resting/avg/max HR
-- are all fields on the SAME ClientDaily object per the confirmed
-- Health API spec, so one push = one row here, no cross-type conflict.
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

-- "sleeps" push (ClientSleep).
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

-- "hrv-summary" push (ClientHRVSummary).
create table if not exists garmin_hrv (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  last_night_avg integer,
  last_night_5min_high integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- "pulse-ox" push (ClientDailySpo2Acclimation) — avg/min computed from
-- the raw per-epoch readings at parse time (Garmin's own object has no
-- single "daily average" field), so these are explicitly OUR average,
-- not a Garmin-reported summary number — labeled that way in the UI.
create table if not exists garmin_pulse_ox (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  avg_spo2 numeric,
  min_spo2 numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- "respiration" push — avg breaths/min, same "computed by us from raw
-- per-epoch readings" caveat as pulse ox above.
create table if not exists garmin_respiration (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  avg_breaths_per_min numeric,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- "body-compositions" push (ClientBodyComp) — a measurement EVENT, not
-- a daily aggregate (an athlete may step on a scale 0, 1, or several
-- times a day), so this is append-only, not upserted by date.
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

-- "hydration" push.
create table if not exists garmin_hydration (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  fluid_intake_ml integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

-- "health-snapshot" push — a nested array of per-metric summaries
-- ({summaryType, minValue, maxValue, avgValue}); kept as jsonb rather
-- than over-normalized into columns, since it's a variable-length list
-- of metric types, not a fixed record shape.
create table if not exists garmin_health_snapshot (
  athlete_id uuid not null references athletes(id) on delete cascade,
  calendar_date date not null,
  summaries jsonb,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (athlete_id, calendar_date)
);

alter table garmin_daily_health enable row level security;
alter table garmin_sleep enable row level security;
alter table garmin_hrv enable row level security;
alter table garmin_pulse_ox enable row level security;
alter table garmin_respiration enable row level security;
alter table garmin_body_comp enable row level security;
alter table garmin_hydration enable row level security;
alter table garmin_health_snapshot enable row level security;

-- Readable by any signed-in athlete (same "shared coach log" openness
-- strava_activities/strava_daily_load already have), written only by
-- the service-role webhook/parser — never from the browser.
create policy garmin_daily_health_select on garmin_daily_health for select to authenticated using (true);
create policy garmin_sleep_select on garmin_sleep for select to authenticated using (true);
create policy garmin_hrv_select on garmin_hrv for select to authenticated using (true);
create policy garmin_pulse_ox_select on garmin_pulse_ox for select to authenticated using (true);
create policy garmin_respiration_select on garmin_respiration for select to authenticated using (true);
create policy garmin_body_comp_select on garmin_body_comp for select to authenticated using (true);
create policy garmin_hydration_select on garmin_hydration for select to authenticated using (true);
create policy garmin_health_snapshot_select on garmin_health_snapshot for select to authenticated using (true);

-- Device-measured VO2max/Fitness Age ("user-metrics" push,
-- ClientUserMetrics) — kept as plain columns on athletes (latest value
-- only, no history table) since the dashboard only ever wants "the
-- current number," same reasoning strava_weight_kg/strava_stats already
-- use for other Strava-sourced athlete-level fields. Deliberately
-- separate from the existing manually-entered `vo2max` column — this one
-- is device-measured, not athlete-entered, and the two should never be
-- silently merged (the UI labels which is which).
alter table athletes add column if not exists garmin_vo2max numeric;
alter table athletes add column if not exists garmin_vo2max_cycling numeric;
alter table athletes add column if not exists garmin_fitness_age integer;
alter table athletes add column if not exists garmin_health_synced_at timestamptz;
