-- Cadencia — 009: athlete-level Strava data (not per-activity) — real
-- weight from the athlete's Strava profile, and aggregate totals
-- (recent 4 weeks / year-to-date / all-time, per sport) from
-- GET /athletes/{id}/stats. Run once in the SQL editor. Idempotent
-- (safe to re-run).

alter table athletes
  add column if not exists strava_weight_kg numeric(5,1),
  add column if not exists strava_stats jsonb,
  add column if not exists strava_profile_synced_at timestamptz;

comment on column athletes.strava_weight_kg is 'Weight in kg, from Strava''s GET /athlete (only present if the athlete set it there).';
comment on column athletes.strava_stats is 'Raw response from Strava''s GET /athletes/{id}/stats — recent (4wk) / YTD / all-time totals per sport.';
