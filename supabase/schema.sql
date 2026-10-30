-- Cadencia — initial schema. Run this once in the Supabase SQL editor on a
-- fresh project before deploying. Idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ─── athletes ──────────────────────────────────────────────────────────────
-- Fixed roster of two: Juan and José. `auth_user_id` links a row to a real
-- Supabase Auth user once that user is created (see CLAUDE.md — this app
-- has no self-signup; the two accounts are created by hand once).
create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('juan', 'jose')),
  name text not null,
  initials text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into athletes (slug, name, initials)
values
  ('juan', 'Juan', 'JB'),
  ('jose', 'José Miguel', 'JE')
on conflict (slug) do nothing;

-- ─── workouts ──────────────────────────────────────────────────────────────
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race')),
  title text not null,
  start time,
  minutes integer not null default 0,
  km numeric(6,2) not null default 0,
  notes text not null default '',
  done boolean not null default false,
  strava_activity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workouts_athlete_date_idx on workouts (athlete_id, date);

-- ─── templates ─────────────────────────────────────────────────────────────
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('swim', 'bike', 'run', 'gym', 'race')),
  title text not null,
  minutes integer not null default 0,
  km numeric(6,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- ─── strava_activities ──────────────────────────────────────────────────────
-- Cache of activities pulled from Strava's API. `id` is Strava's own
-- activity id (stored as text since it's a 64-bit int Strava may change
-- representation of). Written only by the service-role sync route.
create table if not exists strava_activities (
  id text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  name text not null default '',
  sport_type text not null default '',
  start_date timestamptz not null,
  moving_time_s integer not null default 0,
  distance_m numeric(10,1) not null default 0,
  average_cadence numeric(6,2),
  average_speed numeric(6,3),
  raw jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists strava_activities_athlete_date_idx on strava_activities (athlete_id, start_date desc);

-- workouts.strava_activity_id references strava_activities(id) — added as a
-- separate statement so creation order doesn't matter on a fresh run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workouts_strava_activity_id_fkey'
  ) then
    alter table workouts
      add constraint workouts_strava_activity_id_fkey
      foreign key (strava_activity_id) references strava_activities(id) on delete set null;
  end if;
end $$;

-- ─── strava_connections ─────────────────────────────────────────────────────
-- Holds real OAuth tokens. RLS enabled with NO policies at all — service-role
-- only, same strictness as every secret-holding table in the Operations Hub
-- codebase (order_tracking_links, sa_reviews, etc.). Never read or written
-- from the browser.
create table if not exists strava_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  strava_athlete_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

-- ─── updated_at trigger for workouts ────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists workouts_set_updated_at on workouts;
create trigger workouts_set_updated_at
  before update on workouts
  for each row execute function set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- This is a shared, two-person coach log, not a siloed multi-tenant app:
-- any authenticated athlete (Juan or José) can read and write both
-- athletes' workouts/templates — the "who" switch in the UI is a view
-- filter, not a security boundary. strava_connections stays locked to
-- service-role only, since it holds real OAuth tokens.

alter table athletes enable row level security;
drop policy if exists athletes_select_authenticated on athletes;
create policy athletes_select_authenticated on athletes
  for select to authenticated using (true);

alter table workouts enable row level security;
drop policy if exists workouts_all_authenticated on workouts;
create policy workouts_all_authenticated on workouts
  for all to authenticated using (true) with check (true);

alter table templates enable row level security;
drop policy if exists templates_all_authenticated on templates;
create policy templates_all_authenticated on templates
  for all to authenticated using (true) with check (true);

alter table strava_activities enable row level security;
drop policy if exists strava_activities_select_authenticated on strava_activities;
create policy strava_activities_select_authenticated on strava_activities
  for select to authenticated using (true);
-- No insert/update/delete policy — written only by the service-role sync route.

alter table strava_connections enable row level security;
-- Deliberately no policies at all.
