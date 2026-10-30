-- Cadencia — 011: comprehensive athlete profile — per explicit request
-- ("tiene que verse así de completo como el perfil de un triatleta...
-- zonas, VO2 max, todo, mejores tiempos... cuestionario súper completo").
-- Run once in the SQL editor. Idempotent (safe to re-run).

alter table athletes
  add column if not exists birth_date date,
  add column if not exists sex text check (sex is null or sex in ('male', 'female', 'other')),
  add column if not exists height_cm numeric,
  add column if not exists weight_kg numeric,
  add column if not exists resting_hr integer,
  add column if not exists max_hr integer,
  add column if not exists goal_race_name text,
  add column if not exists goal_race_date date,
  add column if not exists goal_distance text,
  add column if not exists goal_notes text,
  add column if not exists personal_bests jsonb not null default '[]'::jsonb;

comment on column athletes.weight_kg is 'Manually entered body weight (kg) — distinct from strava_weight_kg, which is auto-pulled from Strava and may be stale/unset if the athlete never set it there.';
comment on column athletes.resting_hr is 'Resting heart rate (bpm), self-reported.';
comment on column athletes.max_hr is 'Max heart rate (bpm), self-reported or from a field test — distinct from strava_activities.max_heart_rate, which is the highest HR seen on any one synced activity.';
comment on column athletes.goal_race_name is 'The race this athlete is training toward, e.g. "Ironman 70.3 Cozumel".';
comment on column athletes.goal_distance is 'Free text, e.g. "Half Ironman (70.3)", "Marathon" — not a controlled vocabulary.';
comment on column athletes.personal_bests is 'Array of {id, sport, distanceLabel, distanceMeters, timeSec, date, raceName} — self-reported best times, used as the race predictor''s input (see src/lib/racePredictor.ts). distanceMeters is null for a non-running PB with no standard distance match, in which case it is excluded from the predictor.';
