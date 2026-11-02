-- Confirmed live (Nov 2026, via Garmin's own "OAuth2 Tools" interactive
-- walkthrough) that Garmin's OAuth 2.0 authorize step requires PKCE
-- (code_verifier/code_challenge/S256) — not just a plain authorization
-- code grant. The code_verifier generated when building the authorize
-- URL has to survive the round trip to Garmin and back, so it's stashed
-- here keyed by a random `state`, then looked up and deleted in
-- /api/garmin-dev/callback. See CLAUDE.md's "Garmin Connect Developer
-- Program" section.
create table if not exists garmin_oauth_pkce (
  state text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

alter table garmin_oauth_pkce enable row level security;
-- Deliberately no policies at all — service-role only, holds a value
-- that's security-sensitive for the brief OAuth round trip.
