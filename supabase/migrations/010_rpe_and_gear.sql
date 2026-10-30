-- Cadencia — 010: RPE (perceived exertion, 0-10) on workouts, and gear
-- (shoes/bike) used, pulled from Strava's own athlete profile. Run once
-- in the SQL editor. Idempotent (safe to re-run).

alter table workouts
  add column if not exists rpe integer check (rpe is null or (rpe >= 0 and rpe <= 10));

comment on column workouts.rpe is 'Rating of Perceived Exertion, Borg CR10 scale (0 = no exertion, 10 = maximal) — set by the athlete after the workout.';

alter table strava_activities
  add column if not exists gear_name text;

alter table athletes
  add column if not exists strava_gear jsonb;

comment on column strava_activities.gear_name is 'Shoe or bike name used for this activity, resolved from Strava''s own gear list at sync time (raw.gear_id).';
comment on column athletes.strava_gear is 'Raw shoes + bikes list from Strava''s GET /athlete — kept for reference/future use.';
