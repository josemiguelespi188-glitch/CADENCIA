-- Garmin Connect Developer Program (real OAuth tier, Starter Access) --
-- deliberately separate from garmin_connections (migration 015, the
-- read-only Personal API key-paste flow) since the auth model, data
-- shape, and capabilities are completely different. See CLAUDE.md's
-- "Garmin Connect Developer Program" section.

create table if not exists garmin_dev_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  garmin_user_id text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

alter table garmin_dev_connections enable row level security;
-- Deliberately no policies at all — service-role only, same strictness
-- as strava_connections/coros_connections/garmin_connections.

-- Starter Access delivers data by PUSH ONLY (no pull/poll endpoint) --
-- Garmin calls our webhook whenever an athlete's device syncs. The
-- exact payload shape per API family (Activity/Health/Women's
-- Health/Training) is unconfirmed from this sandbox (developer.garmin.com
-- is blocked here), so every push is stored verbatim first and parsed
-- later once the real shape is confirmed against a live payload — see
-- app/api/webhooks/garmin/route.ts.
create table if not exists garmin_push_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed boolean not null default false
);

alter table garmin_push_events enable row level security;
-- Deliberately no policies at all — service-role only; this table may
-- hold raw End User health data from Garmin.
