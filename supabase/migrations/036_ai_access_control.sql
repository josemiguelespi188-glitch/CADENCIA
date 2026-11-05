-- AI access control (Nov 2026) — per-athlete permission + weekly prompt
-- limit for "Generate with AI", plus a global admin-editable instructions
-- block appended to every Claude call. See CLAUDE.md's "AI access control"
-- section.

alter table athletes add column if not exists ai_enabled boolean not null default false;
alter table athletes add column if not exists ai_weekly_limit integer not null default 5;

comment on column athletes.ai_enabled is 'Can use "Generate with AI" (WorkoutDialog) and the automatic Strava description write-back. Admin-only write — see athletes_guard_admin_fields below.';
comment on column athletes.ai_weekly_limit is 'Max "Generate with AI" prompts per rolling 7 days. Admin-only write — see athletes_guard_admin_fields below.';

-- Renamed from athletes_guard_is_admin (same trigger, widened scope) — now
-- also blocks self-editing ai_enabled/ai_weekly_limit from any write path
-- except the service-role client (the admin API routes), same reasoning
-- as is_admin itself: these are admin-granted permissions, not athlete
-- preferences.
drop trigger if exists athletes_guard_is_admin_trigger on athletes;
drop function if exists athletes_guard_is_admin();

create or replace function athletes_guard_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.ai_enabled is distinct from old.ai_enabled then
      new.ai_enabled := old.ai_enabled;
    end if;
    if new.ai_weekly_limit is distinct from old.ai_weekly_limit then
      new.ai_weekly_limit := old.ai_weekly_limit;
    end if;
  end if;
  return new;
end;
$$;

create trigger athletes_guard_admin_fields_trigger
  before update on athletes
  for each row execute function athletes_guard_admin_fields();

-- One row per "Generate with AI" attempt that passed the permission gate
-- (win or lose on the actual Claude call) — the weekly limit is a count
-- of real attempts over a rolling 7 days (created_at >= now() - 7 days),
-- not a calendar-week reset. Service-role only, same strictness as every
-- other connections/usage table in this app.
create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_athlete_created_idx on ai_usage_log (athlete_id, created_at);

alter table ai_usage_log enable row level security;

-- Global, admin-editable text appended to both Claude system prompts
-- (generateWorkoutFromPrompt, generateActivityDescription) — a real
-- single-row singleton, same idiom coros_mcp_client already uses.
create table if not exists ai_settings (
  id boolean primary key default true check (id),
  instructions text not null default '',
  updated_at timestamptz not null default now()
);

alter table ai_settings enable row level security;

insert into ai_settings (id, instructions) values (true, '') on conflict (id) do nothing;
