-- Cadencia — 004: supports for Strava auto-complete + AI description write-back.
-- Run once in the SQL editor. Idempotent (safe to re-run).

alter table strava_activities
  add column if not exists local_date date,
  add column if not exists description_written_at timestamptz;

comment on column strava_activities.local_date is
  'Activity start date in the athlete''s own local time (from Strava''s start_date_local, date part only) — used to match a synced activity to a planned workouts row by calendar day, since start_date is UTC and can land on a different day than the athlete actually trained.';
comment on column strava_activities.description_written_at is
  'When this activity was last processed for auto-complete matching + the AI description write-back to Strava (set whether or not the write actually succeeded — best-effort, not retried, same pattern as every other optional notification in this codebase).';

create index if not exists strava_activities_local_date_idx on strava_activities (athlete_id, local_date);
