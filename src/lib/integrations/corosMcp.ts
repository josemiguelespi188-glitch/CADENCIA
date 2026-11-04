import { createServiceClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/integrations/strava";
import {
  discoverOAuthServerInfo,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthServerInfo,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * COROS MCP — the REAL path for pushing/reading structured workouts,
 * confirmed by a direct reply from api@coros.com (Nov 2026): "MCP covers
 * your use case today with no application or approval needed," unlike
 * the Partner API `lib/integrations/coros.ts` was built against (see
 * that file's own header — it's superseded, not deleted). Read
 * CLAUDE.md's "COROS Partner API application superseded by COROS MCP"
 * and "COROS MCP: real OAuth + tool discovery" sections before touching
 * this file.
 *
 * **What's confirmed, and from where:**
 * - The real MCP endpoint, `COROS_MCP_URL` below, and the real write/
 *   read tool names (`createScheduledWorkout`, `scheduleWorkout`, etc.)
 *   — from COROS's own `coroslab/COROS-MCP` GitHub docs, reached via
 *   `raw.githubusercontent.com` (this sandbox's proxy blocks
 *   `github.com` and `api.github.com` directly, but that specific raw-
 *   content subdomain works).
 * - **The OAuth mechanism built here — RFC 9728/8414 metadata discovery,
 *   RFC 7591 Dynamic Client Registration, PKCE — is the standard,
 *   published Model Context Protocol Authorization flow**, not a guess:
 *   the user confirmed directly (pointing at oauth.net's own reference)
 *   that COROS uses plain standard OAuth 2.0, which combined with COROS's
 *   own docs never mentioning a manual "create an app, get a Client ID"
 *   step (unlike Strava/Garmin/WHOOP's dev portals) is exactly the shape
 *   DCR is for. Built using the official `@modelcontextprotocol/sdk`
 *   package's own `client/auth.js` helpers (discoverOAuthServerInfo,
 *   registerClient, startAuthorization, exchangeAuthorization,
 *   refreshAuthorization) rather than hand-rolled — these implement the
 *   spec directly, so trust them the same way this codebase already
 *   trusts "generic OAuth2 is safe to code" for Strava/WHOOP.
 *
 * **What's still NOT confirmed**: the internal schema of a `course`
 * object (a workout's warmup/interval/recovery/cooldown sections and
 * pace/HR/power targets) that every write tool takes — no doc reachable
 * from this sandbox spells it out. MCP is self-describing though: once
 * a real connection exists, `captureCorosToolCatalog()` below calls the
 * protocol's own `tools/list` and stores the raw result (same "capture
 * now, parse later" discipline this codebase already applies to Garmin
 * webhook payloads) — read `coros_connections.tools_catalog` for the
 * real schema before writing a push function, rather than guessing it.
 * `pushStructuredWorkoutToCorosMcp()` is deliberately NOT built yet for
 * this exact reason.
 *
 * This sandbox could never test any of this live — `mcp.coros.com` and
 * `support.coros.com` both fail the egress proxy's CONNECT tunnel, the
 * same way `developer.garmin.com` did before Garmin's real docs got
 * pasted directly into chat. Confirm the whole flow once deployed.
 */

export const COROS_MCP_URL = "https://mcp.coros.com/mcp";

function corosMcpRedirectUrl(): string {
  return `${getSiteBaseUrl()}/api/coros/callback`;
}

function randomState(): string {
  return crypto.randomUUID();
}

/**
 * Loads the app's cached Dynamic Client Registration (one row, shared by
 * every athlete), registering a new one via RFC 7591 if none exists yet.
 * Registration happens once ever, not once per athlete or per connect
 * click — re-registering every time would be wasteful and isn't how DCR
 * is meant to be used.
 */
async function getOrRegisterCorosClient(serverInfo: OAuthServerInfo): Promise<OAuthClientInformationFull> {
  const db = createServiceClient();
  const { data: existing } = await db.from("coros_mcp_client").select("*").eq("id", true).maybeSingle();
  if (existing) {
    return {
      client_id: existing.client_id,
      client_secret: existing.client_secret ?? undefined,
      client_id_issued_at: existing.client_id_issued_at ? Math.floor(new Date(existing.client_id_issued_at).getTime() / 1000) : undefined,
      redirect_uris: [corosMcpRedirectUrl()],
    } as OAuthClientInformationFull;
  }

  const registered = await registerClient(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientMetadata: {
      client_name: "Cadencia",
      redirect_uris: [corosMcpRedirectUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });

  const { error } = await db.from("coros_mcp_client").insert({
    id: true,
    issuer: serverInfo.authorizationServerUrl,
    client_id: registered.client_id,
    client_secret: registered.client_secret ?? null,
    client_id_issued_at: registered.client_id_issued_at ? new Date(registered.client_id_issued_at * 1000).toISOString() : null,
    authorization_endpoint: serverInfo.authorizationServerMetadata?.authorization_endpoint ?? "",
    token_endpoint: serverInfo.authorizationServerMetadata?.token_endpoint ?? "",
    registration_endpoint: serverInfo.authorizationServerMetadata?.registration_endpoint ?? null,
    registration_response: registered,
  });
  // A concurrent first-ever connect could race two registrations — the
  // singleton check constraint rejects the second insert; that's fine,
  // the first one already saved a usable client, so don't treat this as
  // fatal for the request that lost the race.
  if (error && error.code !== "23505") {
    console.error("Failed to persist COROS MCP client registration", error);
  }

  return registered;
}

export async function buildCorosMcpAuthorizeUrl(athleteId: string): Promise<URL> {
  const serverInfo = await discoverOAuthServerInfo(COROS_MCP_URL);
  const clientInfo = await getOrRegisterCorosClient(serverInfo);
  const state = randomState();

  const { authorizationUrl, codeVerifier } = await startAuthorization(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientInformation: clientInfo,
    redirectUrl: corosMcpRedirectUrl(),
    state,
    resource: serverInfo.resourceMetadata?.resource,
  });

  const db = createServiceClient();
  const { error } = await db.from("coros_mcp_pkce").insert({ state, athlete_id: athleteId, code_verifier: codeVerifier });
  if (error) throw new Error(`Could not start COROS authorization: ${error.message}`);

  return authorizationUrl;
}

export interface CorosMcpCallbackResult {
  athleteId: string;
}

export async function handleCorosMcpCallback(code: string, state: string): Promise<CorosMcpCallbackResult> {
  const db = createServiceClient();
  const { data: pending } = await db.from("coros_mcp_pkce").select("*").eq("state", state).maybeSingle();
  if (!pending) throw new Error("Unknown or expired COROS authorization state.");
  await db.from("coros_mcp_pkce").delete().eq("state", state);

  const serverInfo = await discoverOAuthServerInfo(COROS_MCP_URL);
  const clientInfo = await getOrRegisterCorosClient(serverInfo);

  const tokens = await exchangeAuthorization(serverInfo.authorizationServerUrl, {
    metadata: serverInfo.authorizationServerMetadata,
    clientInformation: clientInfo,
    authorizationCode: code,
    codeVerifier: pending.code_verifier,
    redirectUri: corosMcpRedirectUrl(),
    resource: serverInfo.resourceMetadata?.resource,
  });

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 1800) * 1000).toISOString();
  const { error } = await db.from("coros_connections").upsert(
    {
      athlete_id: pending.athlete_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt,
      scope: tokens.scope ?? null,
      issuer: serverInfo.authorizationServerUrl,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "athlete_id" }
  );
  if (error) throw new Error(`Could not save COROS connection: ${error.message}`);

  // Best-effort: capture the real tool catalog right away so the actual
  // `course` schema is sitting in the DB the next time this feature is
  // worked on, instead of needing another round of doc-hunting. Must
  // never fail the connect itself.
  try {
    await captureCorosToolCatalog(pending.athlete_id, tokens.access_token);
  } catch (e) {
    console.error("Failed to capture COROS tool catalog after connect", e);
  }

  return { athleteId: pending.athlete_id };
}

/** Refreshes and persists a new access token for `athleteId`, returning
 * it, or null if there's no COROS connection for this athlete at all. */
export async function getValidCorosMcpAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data } = await db.from("coros_connections").select("*").eq("athlete_id", athleteId).maybeSingle();
  if (!data) return null;

  const stillValid = new Date(data.expires_at).getTime() - Date.now() > 5 * 60 * 1000;
  if (stillValid) return data.access_token;
  if (!data.refresh_token) return data.access_token;

  try {
    const serverInfo = await discoverOAuthServerInfo(COROS_MCP_URL);
    const clientInfo = await getOrRegisterCorosClient(serverInfo);
    const tokens = await refreshAuthorization(data.issuer ?? serverInfo.authorizationServerUrl, {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation: clientInfo,
      refreshToken: data.refresh_token,
    });
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 1800) * 1000).toISOString();
    await db
      .from("coros_connections")
      .update({ access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? data.refresh_token, expires_at: expiresAt })
      .eq("athlete_id", athleteId);
    return tokens.access_token;
  } catch (e) {
    // Same concurrent-refresh race already handled for Strava/WHOOP/
    // Garmin/COROS's old scaffold: a near-simultaneous call may have
    // already refreshed this row — re-fetch once before giving up.
    console.error("COROS token refresh failed, re-checking for a concurrent refresh", e);
    const { data: refetched } = await db.from("coros_connections").select("*").eq("athlete_id", athleteId).maybeSingle();
    if (refetched && new Date(refetched.expires_at).getTime() - Date.now() > 0) return refetched.access_token;
    return null;
  }
}

function corosMcpClient(accessToken: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(new URL(COROS_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: "cadencia", version: "1.0.0" });
  return { client, transport };
}

/** Calls the protocol's own `tools/list` and stores the raw response —
 * the real, confirmed schema for every COROS MCP tool, including the
 * still-unconfirmed `course` object every write tool takes. */
export async function captureCorosToolCatalog(athleteId: string, accessToken: string): Promise<unknown> {
  const { client, transport } = corosMcpClient(accessToken);
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const db = createServiceClient();
    await db
      .from("coros_connections")
      .update({ tools_catalog: result.tools, tools_captured_at: new Date().toISOString() })
      .eq("athlete_id", athleteId);
    return result.tools;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * NOT BUILT YET — on purpose. The real `course` payload schema (how a
 * workout's warmup/interval/recovery/cooldown sections and pace/HR/
 * power targets are represented) is unconfirmed from any source reached
 * so far. Read `coros_connections.tools_catalog` (captured by
 * `captureCorosToolCatalog` above) for the real `createScheduledWorkout`
 * input schema before implementing this — guessing it would repeat the
 * exact mistake the old Partner-API `tp/list/push` scaffold already
 * made. Throws a clear error rather than attempting a call that's very
 * likely wrong.
 */
export async function pushStructuredWorkoutToCorosMcp(): Promise<never> {
  throw new Error(
    "Not built yet: COROS MCP's real `course` payload schema is unconfirmed. See coros_connections.tools_catalog (captured on connect) for the real schema, and lib/integrations/corosMcp.ts's file header."
  );
}
