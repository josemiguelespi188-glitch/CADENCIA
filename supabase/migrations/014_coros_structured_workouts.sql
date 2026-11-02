-- Cadencia — 014: COROS OAuth connection storage + structured-workout
-- steps on workouts. Prep work for the "Structured Workouts and Training
-- Plans Sync" capability applied for in the COROS Partner API application
-- — see CLAUDE.md's "COROS structured-workout push (prep work)" section.
-- Run once in the SQL editor. Idempotent (safe to re-run).

-- ─── coros_connections ──────────────────────────────────────────────────
-- Mirrors strava_connections exactly (same shape, same strictness) — real
-- OAuth tokens, RLS enabled with NO policies at all, service-role only.
create table if not exists coros_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  coros_athlete_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

alter table coros_connections enable row level security;
-- Deliberately no policies at all — service-role only, never read or
-- written from the browser, same as strava_connections.

-- ─── workouts.workout_steps ─────────────────────────────────────────────
-- A structured representation of a workout (warmup/work/recovery/cooldown
-- steps, each with a duration + target, one level of repeat grouping) —
-- the Cadencia-side data this app was missing before any platform push
-- (COROS, Garmin, or otherwise) could be meaningful. Null/empty means
-- "no structure yet" — workouts.notes/workout_type (free text) keep
-- working exactly as before regardless; this is additive, not a
-- replacement.
alter table workouts
  add column if not exists workout_steps jsonb not null default '[]'::jsonb;

comment on column workouts.workout_steps is 'Array of WorkoutStep (see src/lib/types.ts): {id, kind, durationType, durationValue, targetType, targetLow, targetHigh, repeatCount?}. Empty array means this workout has no structured steps, only the free-text notes/workout_type fields.';
