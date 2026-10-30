-- Cadencia — 008: extra per-activity Strava metrics, extracted from the
-- `raw` JSON already stored by every sync (no new API call needed — see
-- CLAUDE.md's "What else Strava gives us" note). Run once in the SQL
-- editor. Idempotent (safe to re-run).

alter table strava_activities
  add column if not exists relative_effort integer,
  add column if not exists total_elevation_gain_m numeric(7,1),
  add column if not exists max_heart_rate numeric(5,1),
  add column if not exists average_watts numeric(6,1),
  add column if not exists calories numeric(7,1);

comment on column strava_activities.relative_effort is 'Strava''s own "Relative Effort" score (raw.suffer_score) — their proprietary intensity metric, not computed by us.';
comment on column strava_activities.total_elevation_gain_m is 'Total elevation gain, in meters.';
comment on column strava_activities.max_heart_rate is 'Max heart rate for the activity, in bpm.';
comment on column strava_activities.average_watts is 'Average power, in watts (rides with a power meter only).';
comment on column strava_activities.calories is 'Estimated calories burned, from raw.kilojoules where present.';
