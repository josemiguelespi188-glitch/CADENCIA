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
}

/** Fetches the athlete's most recent activities (Strava's own pagination, newest first). */
export async function fetchRecentStravaActivities(
  accessToken: string,
  perPage = 30
): Promise<StravaSummaryActivity[]> {
  const params = new URLSearchParams({ per_page: String(perPage) });
  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
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

/** Maps a sport-shaped Cadencia value from Strava's own `sport_type` string. */
export function mapStravaSportType(sportType: string): "swim" | "bike" | "run" | "gym" | null {
  const s = sportType.toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "bike";
  if (s.includes("run")) return "run";
  if (s.includes("weight") || s.includes("workout") || s.includes("training")) return "gym";
  return null;
}
