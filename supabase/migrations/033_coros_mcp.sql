-- Real COROS MCP integration (Nov 2026) — replaces the Partner API
-- scaffold from migration 014 for actually pushing/reading workouts.
-- See CLAUDE.md's "COROS Partner API application superseded by COROS
-- MCP" and "COROS MCP: real OAuth + tool discovery" sections. Built
-- against the official Model Context Protocol Authorization spec
-- (metadata discovery + RFC 7591 Dynamic Client Registration + PKCE),
-- confirmed as the right shape by the user pointing at oauth.net's own
-- standard OAuth 2.0 reference — COROS's docs never mention a manual
-- "create an app, get a Client ID" step the way Strava/Garmin/WHOOP's
-- dev portals do, which is what DCR is for. The real MCP endpoint
-- (`https://mcp.coros.com/mcp`) and real tool names are confirmed from
-- COROS's own `coroslab/COROS-MCP` GitHub docs; the exact `course`
-- payload schema for a workout's steps/targets is NOT confirmed from
-- anywhere reachable in this sandbox — see
-- lib/integrations/corosMcp.ts's file header.

-- ─── coros_connections ──────────────────────────────────────────────────
-- Reuses the table migration 014 already created (same shape: real OAuth
-- tokens, RLS enabled, no policies, service-role only) — just widened for
-- what MCP's flow actually needs. `coros_athlete_id` (the old Partner-API
-- column) stays unused/null under MCP; nothing reads or writes it anymore.
-- `refresh_token` was `not null` under the old Partner-API assumption
-- that every token response includes one — not guaranteed under plain
-- OAuth 2.0 (WHOOP's own integration hit exactly this: no refresh_token
-- without explicitly requesting the `offline` scope, see CLAUDE.md's
-- WHOOP section). COROS MCP's token behavior here is unconfirmed, so
-- this is relaxed defensively rather than risking a connect that
-- otherwise works failing outright on a NOT NULL violation.
alter table coros_connections alter column refresh_token drop not null;

alter table coros_connections add column if not exists issuer text;
alter table coros_connections add column if not exists tools_catalog jsonb;
alter table coros_connections add column if not exists tools_captured_at timestamptz;

comment on column coros_connections.issuer is 'The OAuth authorization server URL discovered for this token (RFC 9728/8414) — needed to refresh against the right server later.';
comment on column coros_connections.tools_catalog is 'Raw tools/list response captured right after connecting — the real, self-describing schema for every COROS MCP tool (including the unconfirmed course object), fetched from the protocol itself rather than guessed from docs. See CLAUDE.md.';
comment on column coros_connections.tools_captured_at is 'When tools_catalog was last captured. Null until a connection has successfully listed tools at least once.';

-- ─── coros_mcp_client ────────────────────────────────────────────────────
-- The app's own OAuth client, obtained via Dynamic Client Registration —
-- registered ONCE for the whole app (not per athlete, unlike
-- coros_connections), then reused for every athlete's own authorize/token
-- requests. True-singleton pattern: `id boolean primary key check (id)`
-- means only a single row with id = true can ever exist.
create table if not exists coros_mcp_client (
  id boolean primary key default true,
  issuer text not null,
  client_id text not null,
  client_secret text,
  client_id_issued_at timestamptz,
  authorization_endpoint text not null,
  token_endpoint text not null,
  registration_endpoint text,
  registration_response jsonb,
  created_at timestamptz not null default now(),
  constraint coros_mcp_client_singleton check (id)
);

alter table coros_mcp_client enable row level security;
-- Deliberately no policies at all — service-role only. Holds a
-- dynamically-registered OAuth client secret, same sensitivity as any
-- other *_connections table in this app even though it's one shared row
-- rather than per-athlete.

-- ─── coros_mcp_pkce ──────────────────────────────────────────────────────
-- Mirrors garmin_oauth_pkce exactly — the PKCE code_verifier has to
-- survive the round trip to COROS's consent screen and back, stashed
-- here keyed by a random `state`, looked up and deleted in
-- /api/coros/callback.
create table if not exists coros_mcp_pkce (
  state text primary key,
  athlete_id uuid not null references athletes(id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

alter table coros_mcp_pkce enable row level security;
-- Deliberately no policies at all — service-role only, security-sensitive
-- for the brief OAuth round trip.
