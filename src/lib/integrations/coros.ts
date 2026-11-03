import { createServiceClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/integrations/strava";
import type { Workout, WorkoutStep } from "@/lib/types";

/**
 * COROS OAuth + structured-workout push — prep work for the "Structured
 * Workouts and Training Plans Sync" capability applied for in the COROS
 * Partner API application (see CLAUDE.md's "COROS structured-workout
 * push" section for the full story).
 *
 * **Everything in this file that is COROS-API-SPECIFIC is unconfirmed.**
 * This sandbox could never reach COROS's real API Reference Guide
 * (Dropbox is blocked from here) or `docs.tryterra.co`, so nothing below
 * was built against real documentation — only against generic OAuth2
 * conventions (RFC 6749, safe to build for real) and third-party,
 * reverse-engineered field names mentioned in a forum/open-source project
 * (noted inline below, NOT an official source). Treat every COROS-
 * specific constant, field name, and endpoint path here as a placeholder
 * to verify — and very possibly rewrite — once the real Partner API docs
 * are in hand. Do not wire a "Sync now" button to `pushStructuredWorkoutToCoros`
 * believing it will work; it almost certainly will not, as written.
 */

/**
 * Base URLs are env vars with NO baked-in default — unlike Strava's
 * hardcoded `https://www.strava.com/oauth/authorize` (a real, confirmed
 * URL), guessing COROS's domain here would silently fail in a confusing
 * way instead of the clear "not configured" error this throws. Set these
 * once the real values are known (likely from the Partner API approval
 * email or Reference Guide).
 */
function requireCorosEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. COROS's real API endpoints are unconfirmed in this codebase, see the top of lib/integrations/coros.ts.`
    );
  }
  return value;
}

export function buildCorosAuthorizeUrl(athleteId: string) {
  const authorizeUrl = requireCorosEnv("COROS_AUTHORIZE_URL");
  const clientId = requireCorosEnv("COROS_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${getSiteBaseUrl()}/api/coros/callback`,
    response_type: "code",
    // Scope name is a guess at a conventional "write workouts" scope —
    // unconfirmed, see file header.
    scope: "workout:write",
    state: athleteId,
  });
  return `${authorizeUrl}?${params.toString()}`;
}

interface CorosTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Standard OAuth2 convention (RFC 6749): seconds until expiry from now
   * — NOT an absolute timestamp like Strava's `expires_at`. Assumed here
   * since it's the more common shape; unconfirmed for COROS specifically. */
  expires_in: number;
  /** Guessed field name for COROS's own athlete id in the token response — unconfirmed. */
  athlete_id?: string;
}

export async function exchangeCorosCode(code: string): Promise<CorosTokenResponse> {
  const tokenUrl = requireCorosEnv("COROS_TOKEN_URL");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.COROS_CLIENT_ID,
      client_secret: process.env.COROS_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${getSiteBaseUrl()}/api/coros/callback`,
    }),
  });
  if (!res.ok) throw new Error(`COROS token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshCorosToken(refreshToken: string): Promise<CorosTokenResponse> {
  const tokenUrl = requireCorosEnv("COROS_TOKEN_URL");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.COROS_CLIENT_ID,
      client_secret: process.env.COROS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`COROS token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Same shape as Strava's getValidAccessToken — refreshes + persists if
 * expiring within 5 minutes, returns null if not connected at all. */
export async function getValidCorosAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data: conn } = await db
    .from("coros_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  if (expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return conn.access_token;
  }

  try {
    const refreshed = await refreshCorosToken(conn.refresh_token);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await db
      .from("coros_connections")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: newExpiresAt,
      })
      .eq("athlete_id", athleteId);
    return refreshed.access_token;
  } catch (e) {
    // Same concurrent-refresh race already fixed in strava.ts — see its
    // getValidAccessToken for the full rationale.
    const { data: latest } = await db
      .from("coros_connections")
      .select("access_token, expires_at")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (latest && new Date(latest.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      return latest.access_token;
    }
    throw e;
  }
}

/**
 * Maps one Cadencia WorkoutStep to the shape COROS's push payload is
 * believed to use, per CLAUDE.md's research notes on the unofficial
 * `rCoros` R package's `coros_workouts()` output (`step_name`,
 * `duration_s`, `power_low_w`, `power_high_w`, `sets`) — the only lead
 * ever found on COROS's real field names, and a reverse-engineered,
 * third-party one at that. **Not confirmed against official docs.**
 */
function stepToCorosShape(step: WorkoutStep) {
  return {
    step_name: step.kind,
    duration_s: step.durationType === "time" ? step.durationValue : null,
    // Power fields specifically are the ones the rCoros lead actually
    // named; pace/HR/cadence targets are extrapolated from that same
    // shape, not independently confirmed.
    power_low_w: step.targetType === "power" ? step.targetLow : null,
    power_high_w: step.targetType === "power" ? step.targetHigh : null,
    target_type: step.targetType,
    target_low: step.targetLow,
    target_high: step.targetHigh,
    sets: step.repeatCount ?? 1,
  };
}

/**
 * Pushes a structured workout onto the athlete's COROS account.
 * **Unconfirmed end-to-end** — the endpoint path (`tp/list/push`, per a
 * third-party forum mention, not official docs), the request body shape,
 * and the response shape are all placeholders. This function exists so
 * the calling code (a future "Push to COROS" button) has a stable
 * interface to build against now; the body of this function needs a
 * real rewrite once the Partner API Reference Guide is actually read.
 */
export async function pushStructuredWorkoutToCoros(athleteId: string, workout: Workout): Promise<void> {
  if (!workout.workout_steps.length) {
    throw new Error("This workout has no structured steps to push.");
  }
  const accessToken = await getValidCorosAccessToken(athleteId);
  if (!accessToken) throw new Error("This athlete has no COROS connection.");

  const apiBase = requireCorosEnv("COROS_API_BASE");
  const res = await fetch(`${apiBase}/tp/list/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: workout.title,
      date: workout.date,
      steps: workout.workout_steps.map(stepToCorosShape),
    }),
  });
  if (!res.ok) {
    throw new Error(`COROS workout push failed: ${res.status} ${await res.text()}`);
  }
}
