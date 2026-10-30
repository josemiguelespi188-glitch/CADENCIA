-- Cadencia — 002: open RLS to anon, removing the auth requirement for now.
-- Explicit product decision (Oct 2026): "quita el tema de la autenticacion
-- por el momento, no necesitamos claves ahorita." See the RLS section at
-- the bottom of supabase/schema.sql for the full rationale and the plan to
-- revert this later. Run once in the SQL editor on a project that already
-- has the original schema.sql applied. Idempotent (safe to re-run).

drop policy if exists athletes_select_authenticated on athletes;
drop policy if exists athletes_select_public on athletes;
create policy athletes_select_public on athletes
  for select to anon, authenticated using (true);

drop policy if exists workouts_all_authenticated on workouts;
drop policy if exists workouts_all_public on workouts;
create policy workouts_all_public on workouts
  for all to anon, authenticated using (true) with check (true);

drop policy if exists templates_all_authenticated on templates;
drop policy if exists templates_all_public on templates;
create policy templates_all_public on templates
  for all to anon, authenticated using (true) with check (true);

drop policy if exists strava_activities_select_authenticated on strava_activities;
drop policy if exists strava_activities_select_public on strava_activities;
create policy strava_activities_select_public on strava_activities
  for select to anon, authenticated using (true);

-- strava_connections is untouched — still service-role only, no policies.
