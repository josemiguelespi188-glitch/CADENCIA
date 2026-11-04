-- Communities (Nov 2026, Phase 1 of a larger feature — see CLAUDE.md's
-- "Community" section). Direct request: a social layer where a coach
-- creates a community (a running club, a triathlon group) and athletes
-- join it, see who else is in it, and — in a later pass — compare
-- profiles and see aggregate community stats. This is the FIRST real
-- privacy boundary of any kind in this app: every table before this one
-- is fully open to any authenticated athlete ("shared coach log," see
-- CLAUDE.md's "Data model & auth" section) — communities don't change
-- that for workouts/templates/etc., but membership itself, and anything
-- built on top of it later (compare/aggregate stats), is scoped to who's
-- actually in a given community.

-- ─── athletes.is_coach ───────────────────────────────────────────────────
-- A coach can create a community and (once built) bulk-assign a workout
-- to every member at once. Deliberately NOT guarded like is_admin —
-- this is a self-editable preference, not a trust/security boundary, so
-- it's a plain column any athlete can flip on their own row (same RLS
-- `athletes_update_own` policy every other profile field already uses).
-- Asked at account-creation time (accept-invite's password-setup form)
-- and always editable afterward from the Athlete Profile card.
alter table athletes add column if not exists is_coach boolean not null default false;
comment on column athletes.is_coach is 'Can create Communities and (future) bulk-assign a workout to every member. Self-editable, not admin-guarded.';

-- ─── communities ─────────────────────────────────────────────────────────
create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  -- Nullable + ON DELETE SET NULL rather than CASCADE: this app has no
  -- "delete an athlete" feature today, but a community outliving its
  -- creator's row (if one is ever added) is the safer default than the
  -- whole community vanishing.
  created_by uuid references athletes(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table communities enable row level security;
drop policy if exists communities_select_authenticated on communities;
create policy communities_select_authenticated on communities
  for select to authenticated using (true);

-- Only a coach or admin can create one, and only as themselves
-- (created_by must match the caller) — checked entirely in RLS rather
-- than a server route, consistent with how workouts/templates are
-- already directly browser-writable in this app.
drop policy if exists communities_insert_coach on communities;
create policy communities_insert_coach on communities
  for insert to authenticated
  with check (
    created_by = (select id from athletes where auth_user_id = auth.uid())
    and exists (select 1 from athletes where auth_user_id = auth.uid() and (is_coach or is_admin))
  );

-- ─── community_members ───────────────────────────────────────────────────
-- A plain join, no per-membership role column — the coach of a community
-- is just communities.created_by. Joining/leaving is "automático, sin
-- solicitud," same open philosophy already confirmed for the Friends
-- picker (see CLAUDE.md's "Real auth + admin" section) — any athlete can
-- insert/delete their OWN membership row directly, no approval step, no
-- server route needed.
create table if not exists community_members (
  community_id uuid not null references communities(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, athlete_id)
);

create index if not exists community_members_athlete_idx on community_members (athlete_id);

alter table community_members enable row level security;
drop policy if exists community_members_select_authenticated on community_members;
create policy community_members_select_authenticated on community_members
  for select to authenticated using (true);

drop policy if exists community_members_insert_self on community_members;
create policy community_members_insert_self on community_members
  for insert to authenticated
  with check (athlete_id = (select id from athletes where auth_user_id = auth.uid()));

drop policy if exists community_members_delete_self on community_members;
create policy community_members_delete_self on community_members
  for delete to authenticated
  using (athlete_id = (select id from athletes where auth_user_id = auth.uid()));
