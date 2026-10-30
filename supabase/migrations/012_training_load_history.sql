-- Cadencia — 012: extended training-load history for Fitness/Fatigue/Form
-- (CTL/ATL/TSB). Per explicit decision (Oct 2026): the 42-day CTL EWMA
-- flagged as blocked in CLAUDE.md's "Planned vs Completed" section needs
-- meaningfully more than 30 days of history to converge, so sync now also
-- pulls a lightweight, summary-only history (date + Strava's own Relative
-- Effort score, no per-activity detail) going back further — see
-- CLAUDE.md's "Fitness/Fatigue/Form" note and lib/fitnessForm.ts. Run once
-- in the SQL editor. Idempotent (safe to re-run).

create table if not exists strava_daily_load (
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  -- Sum of Strava's suffer_score (Relative Effort) across every activity
  -- that day — the same proprietary intensity metric already surfaced
  -- per-activity elsewhere in this app, just aggregated daily here as the
  -- Banister model's training-stress input.
  relative_effort numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, date)
);

create index if not exists strava_daily_load_athlete_date_idx on strava_daily_load (athlete_id, date);

comment on table strava_daily_load is 'Daily aggregated training stress (summed Relative Effort), a lightweight summary-only history distinct from strava_activities'' full per-activity detail — used only to compute CTL/ATL/TSB (lib/fitnessForm.ts).';

alter table strava_daily_load enable row level security;
drop policy if exists strava_daily_load_select_public on strava_daily_load;
create policy strava_daily_load_select_public on strava_daily_load
  for select to anon, authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route, same as strava_activities.
