import { createServiceClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * WHOOP integration (Nov 2026) — built from the real WHOOP Developer
 * Platform OpenAPI spec pasted verbatim into this session (unlike
 * Garmin's Health parser, every URL and field name below is copied
 * directly from that spec, not reconstructed from general knowledge —
 * this is a meaningfully higher-confidence integration than the Garmin
 * Health one). See CLAUDE.md's "WHOOP integration" section.
 *
 * **Shape is pull, not push** — the spec has no webhook/subscription
 * endpoint at all, just paginated `GET` collections
 * (`records`/`next_token`) for Cycle, Sleep, Recovery, and Workout, plus
 * two one-shot `GET`s for the athlete's own body measurement and basic
 * profile. So this mirrors Strava's manual "Sync now" model, not
 * Garmin's webhook-receiver model — `/api/whoop/sync` pulls a window of
 * recent data on demand, there's nothing to register with WHOOP beyond
 * the OAuth redirect URI itself.
 *
 * **Confirmed OAuth 2.0 authorization-code grant** (`securitySchemes.
 * OAuth` in the spec): authorize at
 * `https://api.prod.whoop.com/oauth/oauth2/auth`, token at
 * `https://api.prod.whoop.com/oauth/oauth2/token`, API base
 * `https://api.prod.whoop.com/developer`. These are hardcoded (not env
 * vars) since the spec confirms them as fixed, public values — same
 * reasoning `STRAVA_AUTHORIZE_URL`/`STRAVA_TOKEN_URL` are hardcoded in
 * `strava.ts` rather than configurable. Only `WHOOP_CLIENT_ID`/
 * `WHOOP_CLIENT_SECRET` are env vars, since those are the actual secret.
 * Scopes requested: `read:profile read:body_measurement read:cycles
 * read:recovery read:sleep read:workout` — read-only, there is no write
 * scope in the spec at all (WHOOP's public API has no push capability,
 * unlike Garmin's Training API). **Also requests `offline`** — found
 * live (Nov 2026): WHOOP's real token response came back with a null
 * `refresh_token` (violating this app's own not-null constraint,
 * caught by the error check in the callback route), which turned out
 * to be WHOOP-documented behavior, not a bug — WHOOP only issues a
 * refresh token when the authorization request includes the `offline`
 * scope, confirmed via developer.whoop.com's own OAuth docs (not
 * fetchable directly from this sandbox, confirmed via search instead).
 * `offline` isn't a data-access scope (it grants no read access of its
 * own), so it's requested alongside the six real ones, not instead of
 * any of them.
 *
 * **Token revoke is real**: `DELETE /v2/user/access` actually revokes
 * the access grant on WHOOP's own side (per the spec's description:
 * "the associated OAuth client... will no longer receive [webhooks] for
 * this user"), not just a local row deletion — `disconnectWhoop()`
 * calls it best-effort before deleting `whoop_connections`.
 */

const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";
const WHOOP_SCOPES = "read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline";

/** `state` carries the athlete's id through the OAuth round trip, same
 * pattern as Strava's `buildStravaAuthorizeUrl()` — no PKCE in this
 * spec (WHOOP's OAuth is a plain confidential-client authorization-code
 * grant, unlike Garmin's). */
export function buildWhoopAuthorizeUrl(athleteId: string): string {
  const clientId = process.env.WHOOP_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${getSiteBaseUrl()}/api/whoop/callback`,
    response_type: "code",
    scope: WHOOP_SCOPES,
    state: athleteId,
  });
  return `${WHOOP_AUTHORIZE_URL}?${params.toString()}`;
}

interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeWhoopCode(code: string): Promise<WhoopTokenResponse> {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WHOOP_CLIENT_ID ?? "",
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: `${getSiteBaseUrl()}/api/whoop/callback`,
    }),
  });
  if (!res.ok) throw new Error(`WHOOP token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshWhoopToken(refreshToken: string): Promise<WhoopTokenResponse> {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WHOOP_CLIENT_ID ?? "",
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: WHOOP_SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`WHOOP token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Same shape as Strava/Garmin's getValidAccessToken — refreshes +
 * persists if expiring within 5 minutes, returns null if not connected. */
export async function getValidWhoopAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data: conn } = await db
    .from("whoop_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  if (expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return conn.access_token;
  }

  const refreshed = await refreshWhoopToken(conn.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await db
    .from("whoop_connections")
    .update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: newExpiresAt })
    .eq("athlete_id", athleteId);
  return refreshed.access_token;
}

/** Best-effort — revokes on WHOOP's own side per the spec's `DELETE
 * /v2/user/access`. A failure here must never block disconnecting
 * locally (the user still wants the local row gone either way). */
export async function revokeWhoopAccess(accessToken: string): Promise<void> {
  try {
    await fetch(`${WHOOP_API_BASE}/v2/user/access`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    console.error("WHOOP access revoke failed (non-blocking)", e);
  }
}

interface WhoopPage<T> {
  records: T[];
  next_token?: string;
}

async function fetchWhoopPaginated<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "25", ...params });
    if (nextToken) qs.set("nextToken", nextToken);
    const res = await fetch(`${WHOOP_API_BASE}${path}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`WHOOP ${path} fetch failed: ${res.status} ${await res.text()}`);
    const body: WhoopPage<T> = await res.json();
    out.push(...(body.records ?? []));
    nextToken = body.next_token;
    if (!nextToken) break;
  }
  return out;
}

export interface WhoopCycleRecord {
  id: number;
  start: string;
  end: string | null;
  timezone_offset: string;
  score_state: string;
  step_count: number | null;
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
}

export interface WhoopSleepRecord {
  id: string;
  cycle_id: number;
  start: string;
  end: string;
  nap: boolean;
  score_state: string;
  score?: {
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
  };
}

export interface WhoopRecoveryRecord {
  cycle_id: number;
  sleep_id: string;
  score_state: string;
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface WhoopWorkoutRecord {
  id: string;
  sport_name: string;
  start: string;
  end: string;
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations: Record<string, number>;
  };
}

/** `start` is an ISO date-time; WHOOP filters inclusively from it. */
export function fetchWhoopCycles(accessToken: string, start: string) {
  return fetchWhoopPaginated<WhoopCycleRecord>(accessToken, "/v2/cycle", { start });
}

export function fetchWhoopSleep(accessToken: string, start: string) {
  return fetchWhoopPaginated<WhoopSleepRecord>(accessToken, "/v2/activity/sleep", { start });
}

export function fetchWhoopRecovery(accessToken: string, start: string) {
  return fetchWhoopPaginated<WhoopRecoveryRecord>(accessToken, "/v2/recovery", { start });
}

export function fetchWhoopWorkouts(accessToken: string, start: string) {
  return fetchWhoopPaginated<WhoopWorkoutRecord>(accessToken, "/v2/activity/workout", { start });
}

export interface WhoopBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

export async function fetchWhoopBodyMeasurement(accessToken: string): Promise<WhoopBodyMeasurement | null> {
  const res = await fetch(`${WHOOP_API_BASE}/v2/user/measurement/body`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export interface WhoopBasicProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export async function fetchWhoopProfile(accessToken: string): Promise<WhoopBasicProfile | null> {
  const res = await fetch(`${WHOOP_API_BASE}/v2/user/profile/basic`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}
