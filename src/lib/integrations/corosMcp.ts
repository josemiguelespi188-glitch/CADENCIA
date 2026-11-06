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
import type { Sport, Workout, WorkoutStep, WorkoutStepKind } from "@/lib/types";

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
 * **The `course` schema is now confirmed (Nov 2026)** — the user pasted
 * the real `coros_connections.tools_catalog` captured by
 * `captureCorosToolCatalog()` below straight from `/settings`' "View
 * captured schema" button (a real connected account's own `tools/list`
 * response, not a doc summary). `pushStructuredWorkoutToCorosMcp()`
 * below is built directly against `createScheduledWorkout`'s real,
 * confirmed input schema from that catalog — see that function's own
 * header for exactly which parts are a direct schema read vs. this
 * codebase's own interpretive mapping choices (section-type for "rest",
 * the interval-grouping heuristic, cadence targets).
 *
 * This sandbox still can't test any of this live — `mcp.coros.com` and
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

/** Cadencia's Sport -> COROS MCP's confirmed `course.sportType`
 * (createScheduledWorkout: 1=running, 2=cycling, 5=trail running — no
 * other sport is accepted, and nothing in Cadencia's own model maps to
 * "trail running" specifically). `swim`/`gym`/`race`/`brick` have no
 * honest equivalent — rejected with a clear error rather than guessed
 * at (e.g. forcing "race" onto "running" would silently mis-schedule a
 * swim or bike race day as a run on the athlete's real COROS account).
 * Swim is also explicitly still unavailable through COROS MCP at all
 * per COROS's own reply — see this file's header. */
function corosSportType(sport: Sport): 1 | 2 {
  if (sport === "run") return 1;
  if (sport === "bike") return 2;
  throw new Error(
    `COROS MCP can only schedule running or cycling workouts (not "${sport}") — swim, gym, race-day, and brick workouts have no real COROS MCP equivalent yet.`
  );
}

/** Cadencia's WorkoutStepKind -> COROS's confirmed `sectionType` (1=
 * warmup, 2=training, 3=recovery, 4=cooldown). COROS has no standalone
 * "rest" section type — `rest` maps to 3 (recovery) as the closest real
 * fit, an interpretive choice (not a confirmed mapping) since COROS's
 * schema simply has no 5th option for it. */
function corosSectionType(kind: WorkoutStepKind): 1 | 2 | 3 | 4 {
  switch (kind) {
    case "warmup":
      return 1;
    case "work":
      return 2;
    case "recovery":
    case "rest":
      return 3;
    case "cooldown":
      return 4;
  }
}

interface CorosSection {
  sectionType?: 1 | 2 | 3 | 4;
  targetType?: 1 | 2 | 4;
  targetValue?: number;
  intensityType?: 1 | 2 | 4;
  intensityValueStart?: number;
  intensityValueEnd?: number;
  intervalGroup?: true;
  repeats?: number;
  sets?: CorosSection[];
}

/** Cadencia's duration -> COROS's confirmed `targetType`/`targetValue`.
 * Both running(1) and cycling(2) — the only two sports this function
 * ever gets called for, see `corosSportType` — accept targetType 1
 * (distance, meters) or 2 (time, seconds); targetType 3 (climb) is
 * trail-running-only and never reachable here. `durationValue` is
 * already in Cadencia's own internal units (seconds for time, meters
 * for distance — see WorkoutStep's own doc comment), the exact units
 * COROS's schema asks for, so no conversion is needed either way. */
function corosTarget(step: WorkoutStep): Pick<CorosSection, "targetType" | "targetValue"> {
  if (step.durationType === "open" || !step.durationValue) return { targetType: 4 };
  if (step.durationType === "time") return { targetType: 2, targetValue: Math.round(step.durationValue) };
  return { targetType: 1, targetValue: Math.round(step.durationValue) };
}

/** Cadencia's target -> COROS's confirmed `intensityType` +
 * `intensityValueStart`/`intensityValueEnd` (the absolute-range format
 * — always used here, never a zone or percent range, since Cadencia's
 * own `targetLow`/`targetHigh` are already real bpm/sec-per-km/watt
 * numbers, and the schema explicitly says to "use requested bpm/pace/W
 * as given, never approximate them as zones or percentages"). `cadence`
 * has no COROS intensity metric at all (only heart rate/pace/%effort-
 * pace/power) — silently produces no intensity fields rather than
 * guessing one, same as `open`. A single value (targetHigh unset) sends
 * the same number for both endpoints, per the schema's own stated rule
 * for "a single value". */
function corosIntensity(step: WorkoutStep): Pick<CorosSection, "intensityType" | "intensityValueStart" | "intensityValueEnd"> {
  if (step.targetLow === null || step.targetLow === undefined) return {};
  const low = Math.round(step.targetLow);
  const high = Math.round(step.targetHigh ?? step.targetLow);
  switch (step.targetType) {
    case "hr":
      return { intensityType: 1, intensityValueStart: low, intensityValueEnd: high };
    case "pace":
      return { intensityType: 2, intensityValueStart: low, intensityValueEnd: high };
    case "power":
      return { intensityType: 4, intensityValueStart: low, intensityValueEnd: high };
    default:
      return {}; // cadence / open — no COROS equivalent
  }
}

function corosPlainSection(step: WorkoutStep): CorosSection {
  return { sectionType: corosSectionType(step.kind), ...corosTarget(step), ...corosIntensity(step) };
}

/**
 * Builds COROS's confirmed `sections` array from Cadencia's flat
 * `WorkoutStep[]` — see WorkoutStep's own doc comment for why Cadencia
 * never nests repeats itself ("at most ONE level of repeat grouping",
 * originally assumed necessary for COROS specifically; turns out COROS
 * DOES support a real `intervalGroup`/`sets` container after all, a
 * nicer fit than flattening). **Grouping heuristic** (interpretive, not
 * confirmed from any spec): a run of CONSECUTIVE steps sharing the same
 * `repeatCount > 1` (e.g. "work x5" immediately followed by "recovery
 * x5") is folded into one `intervalGroup` with that `repeats` value and
 * those steps as its `sets` — representing "5x(5min work, 3min
 * recovery)" the way a human would actually describe it, rather than
 * flattening into 10 separate top-level sections. A step with no
 * repeatCount (or one that doesn't match its neighbor) stays a plain
 * top-level section.
 */
function corosSectionsFromSteps(steps: WorkoutStep[]): CorosSection[] {
  const sections: CorosSection[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.repeatCount && step.repeatCount > 1) {
      const group = [step];
      let j = i + 1;
      while (j < steps.length && steps[j].repeatCount === step.repeatCount) {
        group.push(steps[j]);
        j++;
      }
      sections.push({ intervalGroup: true, repeats: step.repeatCount, sets: group.map(corosPlainSection) });
      i = j;
    } else {
      sections.push(corosPlainSection(step));
      i++;
    }
  }
  return sections;
}

/**
 * Pushes one workout onto the athlete's real COROS training schedule via
 * `createScheduledWorkout` — confirmed real tool name/schema (Nov 2026,
 * see this file's header). Places it on exactly `workout.date`; COROS's
 * own confirmed constraint is that date must fall within [today, today
 * + 90 days] in the athlete's COROS timezone — not pre-validated here,
 * the real API error is left to surface as-is if it doesn't (same "let
 * the real error bubble up" approach this file already uses for token
 * refresh failures).
 */
export async function pushStructuredWorkoutToCorosMcp(athleteId: string, workout: Workout): Promise<void> {
  if (!workout.workout_steps.length) {
    throw new Error("This workout has no structured steps to push.");
  }
  const sportType = corosSportType(workout.sport);

  const accessToken = await getValidCorosMcpAccessToken(athleteId);
  if (!accessToken) throw new Error("This athlete has no COROS connection.");

  const date = workout.date.replace(/-/g, ""); // YYYY-MM-DD -> yyyyMMdd
  const courseName = (workout.title || "Workout").slice(0, 100);
  const courseDescription = workout.strava_comment || workout.notes || workout.title || "Structured workout from Cadencia.";

  const { client, transport } = corosMcpClient(accessToken);
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "createScheduledWorkout",
      arguments: {
        date,
        course: {
          sportType,
          courseName,
          courseDescription,
          sections: corosSectionsFromSteps(workout.workout_steps),
        },
      },
    });
    if (result.isError) {
      const text = Array.isArray(result.content)
        ? result.content.map((c) => ("text" in c ? c.text : "")).join(" ")
        : JSON.stringify(result.content);
      throw new Error(`COROS rejected the workout: ${text || "unknown error"}`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}
