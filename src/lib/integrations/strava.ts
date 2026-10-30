import { createServiceClient } from "@/lib/supabase/server";

const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

export function getSiteBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/**
 * `state` carries the athlete's id through the OAuth round trip so the
 * callback knows which athlete just authorized, without relying on cookies
 * (Strava's redirect is a fresh top-level navigation).
 */
export function buildStravaAuthorizeUrl(athleteId: string) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: `${getSiteBaseUrl()}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all,activity:write",
    state: athleteId,
  });
  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`;
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Returns a valid access token for this athlete, refreshing and persisting
 * it first if it's expired (or about to expire in the next 5 minutes).
 * Returns null if the athlete has no Strava connection at all.
 */
export async function getValidAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data: conn } = await db
    .from("strava_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  if (expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return conn.access_token;
  }

  const refreshed = await refreshStravaToken(conn.refresh_token);
  await db
    .from("strava_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    })
    .eq("athlete_id", athleteId);
  return refreshed.access_token;
}

export interface StravaSummaryActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  /** Same instant as start_date, but formatted in the athlete's own local
   * time (Strava's own distinction) — used to decide which calendar day
   * the activity belongs to, since start_date is UTC and can land on the
   * wrong day for matching against a planned workout. */
  start_date_local: string;
  moving_time: number;
  distance: number;
  average_cadence?: number;
  average_speed?: number;
  average_heartrate?: number;
  /** Strava's own "Relative Effort" score — their proprietary intensity metric, not computed by us. */
  suffer_score?: number;
  total_elevation_gain?: number;
  max_heartrate?: number;
  average_watts?: number;
  /** Energy, rides only — converted to calories at ~4.184 kJ/kcal when stored. */
  kilojoules?: number;
}

/**
 * Fetches every activity in the last `days` days (default 30 — per
 * explicit product decision, no deep history for now: "no necesito lo
 * histórico, solamente el último mes"). Paginates through Strava's own
 * `page`/`per_page` until a page comes back older than the window or
 * empty, capped at `maxPages` as a hard safety limit (200/page *
 * 10 pages = 2,000 activities, far more than a month could realistically
 * hold even training twice a day).
 */
export async function fetchRecentStravaActivities(
  accessToken: string,
  days = 30,
  maxPages = 10
): Promise<StravaSummaryActivity[]> {
  const after = Math.floor(Date.now() / 1000) - days * 86400;
  const perPage = 200;
  const all: StravaSummaryActivity[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page), after: String(after) });
    const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    const batch: StravaSummaryActivity[] = await res.json();
    all.push(...batch);
    if (batch.length < perPage) break; // last page
  }

  return all;
}

export interface StravaZoneRange {
  min: number;
  max: number;
}

export interface StravaAthleteZones {
  heart_rate?: { custom_zones: boolean; zones: StravaZoneRange[] };
  power?: { zones: StravaZoneRange[] };
}

/**
 * Pulls the zones the athlete has configured in Strava itself, if any —
 * "sacar todo el threshold, rate zone, el FTP... de Strava" per explicit
 * request. Returns null if Strava has nothing configured (a very common
 * case — most athletes never set this up in Strava's own app) or the call
 * fails, so callers fall back to the manually-entered thresholds on
 * `/settings` rather than erroring.
 */
export async function fetchStravaAthleteZones(accessToken: string): Promise<StravaAthleteZones | null> {
  const res = await fetch(`${STRAVA_API_BASE}/athlete/zones`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export interface StravaAthleteProfile {
  id: number;
  weight?: number; // kg
}

/** Pulls the authenticated athlete's own Strava profile (just what we use: id + weight). Null on failure. */
export async function fetchStravaAthleteProfile(accessToken: string): Promise<StravaAthleteProfile | null> {
  const res = await fetch(`${STRAVA_API_BASE}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elevation_gain: number;
}

export interface StravaAthleteStats {
  recent_run_totals?: StravaTotals;
  recent_ride_totals?: StravaTotals;
  recent_swim_totals?: StravaTotals;
  ytd_run_totals?: StravaTotals;
  ytd_ride_totals?: StravaTotals;
  ytd_swim_totals?: StravaTotals;
  all_run_totals?: StravaTotals;
  all_ride_totals?: StravaTotals;
  all_swim_totals?: StravaTotals;
}

/** Recent (4wk) / YTD / all-time totals per sport, from Strava's own aggregation. Null on failure. */
export async function fetchStravaAthleteStats(accessToken: string, stravaAthleteId: number): Promise<StravaAthleteStats | null> {
  const res = await fetch(`${STRAVA_API_BASE}/athletes/${stravaAthleteId}/stats`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Writes a new description onto a Strava activity (requires the `activity:write` scope). */
export async function updateStravaActivityDescription(
  accessToken: string,
  activityId: string,
  description: string
): Promise<void> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`Strava activity update failed: ${res.status} ${await res.text()}`);
}
