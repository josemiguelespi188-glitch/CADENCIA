-- Cadencia — 013: real authentication + admin/invite system, replacing the
-- "auth off" era (see CLAUDE.md's "Data model & auth" section for why it
-- was off, and this migration for the reversal). Run once in the SQL
-- editor. Idempotent (safe to re-run).

-- ─── athletes: email, admin flag, dynamic roster ───────────────────────────

alter table athletes
  add column if not exists email text unique,
  add column if not exists is_admin boolean not null default false;

comment on column athletes.email is 'Login email — set at invite time (or backfilled for an already-linked account). Nullable: an athlete row can exist before anyone is invited to it.';
comment on column athletes.is_admin is 'Can reach /admin (invite people, manage the roster). Only ever changed server-side via the service-role admin API — see the athletes_guard_is_admin trigger below, which blocks any other path from setting it.';

-- The roster is no longer hardcoded to exactly Juan + José — real accounts
-- are created through /admin's invite flow now, so the slug column no
-- longer needs (or should have) a fixed allow-list.
alter table athletes drop constraint if exists athletes_slug_check;

-- Block self-promotion: every write path EXCEPT the service-role client
-- (used only by the admin API routes) silently keeps is_admin unchanged,
-- regardless of what the caller tries to set it to. This is enforced in
-- the database, not just hidden from the UI, since a motivated user could
-- otherwise call the REST API directly with their own session.
create or replace function athletes_guard_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and new.is_admin is distinct from old.is_admin then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists athletes_guard_is_admin_trigger on athletes;
create trigger athletes_guard_is_admin_trigger
  before update on athletes
  for each row execute function athletes_guard_is_admin();

-- José's account already exists and is already linked (see CLAUDE.md) —
-- seeded as the first admin so there's always at least one way into
-- /admin without a manual SQL edit. Juan's account doesn't exist yet;
-- José invites him from /admin once this ships.
update athletes set is_admin = true, email = 'josemiguel.espi188@gmail.com' where slug = 'jose';

-- ─── RLS: real accounts now exist, so anon no longer needs write (or even
-- read) access — tightened back to `authenticated` only, same reversal
-- CLAUDE.md's "Data model & auth" section already flagged as the plan for
-- whenever auth came back. This does NOT restrict who can see/edit WHOSE
-- data among signed-in athletes (see that section's own note on the
-- "Friends" model being open, not gated) — only closes it off to someone
-- with no account at all.

drop policy if exists athletes_select_public on athletes;
drop policy if exists athletes_select_authenticated on athletes;
create policy athletes_select_authenticated on athletes
  for select to authenticated using (true);

-- An athlete can update only their own row (never another athlete's, and
-- never is_admin on any row — see the trigger above). Inserts stay
-- service-role only (no policy here at all) — new rows are only ever
-- created through /admin's invite flow.
drop policy if exists athletes_update_own on athletes;
create policy athletes_update_own on athletes
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists workouts_all_public on workouts;
drop policy if exists workouts_all_authenticated on workouts;
create policy workouts_all_authenticated on workouts
  for all to authenticated using (true) with check (true);

drop policy if exists templates_all_public on templates;
drop policy if exists templates_all_authenticated on templates;
create policy templates_all_authenticated on templates
  for all to authenticated using (true) with check (true);

drop policy if exists strava_activities_select_public on strava_activities;
drop policy if exists strava_activities_select_authenticated on strava_activities;
create policy strava_activities_select_authenticated on strava_activities
  for select to authenticated using (true);

drop policy if exists strava_daily_load_select_public on strava_daily_load;
drop policy if exists strava_daily_load_select_authenticated on strava_daily_load;
create policy strava_daily_load_select_authenticated on strava_daily_load
  for select to authenticated using (true);
