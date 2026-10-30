-- Cadencia — 007: a workout's own "Strava comment" (a human-written
-- summary meant to go verbatim as the Strava activity description, taking
-- priority over the AI-generated one) and an optional free-text workout
-- type (e.g. "Tempo", "Series", "Rodaje suave"). Run once in the SQL
-- editor. Idempotent (safe to re-run).

alter table workouts
  add column if not exists strava_comment text not null default '',
  add column if not exists workout_type text not null default '';

comment on column workouts.strava_comment is
  'Human-written summary meant to go verbatim as the Strava activity description when this workout gets matched to a synced activity — takes priority over the AI-generated description. Empty means fall back to AI generation from `notes`.';
comment on column workouts.workout_type is
  'Free-text workout type/structure (e.g. "Tempo", "Series", "Rodaje suave") — not a controlled vocabulary, purely descriptive.';
