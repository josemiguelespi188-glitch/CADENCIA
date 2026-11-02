-- Cadencia — 015: Garmin Connect Personal API key storage, per athlete.
-- See CLAUDE.md's "Garmin Personal API (read-only, per-athlete)" section
-- for the full story, including why this is deliberately NOT the same
-- shape as strava_connections/coros_connections: Garmin's Personal API
-- is a long-lived self-generated key (not an OAuth authorize/callback
-- flow), explicitly scoped by Garmin's own terms to "an individual
-- accessing their own data" — not something this app can use to act on
-- an athlete's behalf the way the Strava/COROS OAuth connections do.
-- Run once in the SQL editor. Idempotent (safe to re-run).

create table if not exists garmin_connections (
  athlete_id uuid primary key references athletes(id) on delete cascade,
  -- The long-lived secret the athlete pastes in from Garmin Connect's own
  -- settings page. Never sent back to the browser once saved.
  personal_api_key text not null,
  -- Cached bearer token derived from the key above (valid ~24h, no
  -- refresh token exists for this API — see lib/integrations/garmin.ts),
  -- re-derived from personal_api_key when missing/expiring.
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

alter table garmin_connections enable row level security;
-- Deliberately no policies at all — service-role only, same strictness
-- as strava_connections/coros_connections. Never read or written from
-- the browser.

comment on table garmin_connections is 'One row per athlete who has pasted in their own Garmin Connect Personal API key — read-only, personal use only, per Garmin''s own terms for this API tier.';
comment on column garmin_connections.personal_api_key is 'Shown only once by Garmin at generation time — the athlete must copy it immediately. Treat as a long-lived secret.';
