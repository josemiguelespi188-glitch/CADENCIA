-- Cadencia — 005: store the athlete's real zones as configured in Strava
-- itself (GET /athlete/zones), when they have any set up there. Run once
-- in the SQL editor. Idempotent (safe to re-run).

alter table athletes
  add column if not exists strava_hr_zones jsonb,
  add column if not exists strava_power_zones jsonb,
  add column if not exists strava_zones_synced_at timestamptz;

comment on column athletes.strava_hr_zones is
  'Raw heart_rate.zones array from Strava''s GET /athlete/zones, when the athlete has custom zones configured there. Null if Strava returned none.';
comment on column athletes.strava_power_zones is
  'Raw power.zones array from Strava''s GET /athlete/zones, when the athlete has custom zones configured there. Null if Strava returned none.';
