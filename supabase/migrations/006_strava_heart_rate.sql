-- Cadencia — 006: capture average heart rate per synced activity, so the
-- dashboard can show real intensity (avg HR, avg HR as %LTHR) instead of
-- nothing. Run once in the SQL editor. Idempotent (safe to re-run).

alter table strava_activities
  add column if not exists average_heart_rate numeric(5,1);

comment on column strava_activities.average_heart_rate is 'Average heart rate for the activity, in bpm, from Strava''s average_heartrate (only present when the athlete recorded HR and granted read access).';
