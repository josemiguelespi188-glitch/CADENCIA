import { createServiceClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/integrations/strava";
import type { Workout, WorkoutStep } from "@/lib/types";

/**
 * Garmin Connect **Developer Program** (Starter Access) — the real,
 * formal partner tier, confirmed granted to "LineUps FanXperience Inc."
 * (screenshot shared Nov 2026: Activity API, Health API, Women's Health
 * API, Training API, Courses API; Delivery: Push only; Historical Data:
 * not included; User Capacity: up to 1,000 connected users). This is
 * completely separate from `lib/integrations/garmin.ts` (the Personal
 * API key-paste flow built earlier) — different auth model (real OAuth
 * here, not a self-generated personal key), different capability (this
 * tier can also PUSH structured workouts via the Training API, which
 * the Personal API tier cannot do at all).
 *
 * **What's confirmed vs not, from this sandbox:**
 * - The OAuth2 authorization-code-grant SHAPE below is standard,
 *   generic OAuth2 (RFC 6749) — safe to trust as code, same reasoning
 *   already applied to Strava/COROS in this codebase.
 * - The ACTUAL authorize/token/API base URLs are NOT hardcoded here —
 *   `developer.garmin.com` is blocked from this sandbox (same standing
 *   limitation as COROS's Dropbox-hosted docs), so these are required
 *   env vars with no guessed default. Get the real values from the
 *   "Start Guide" / "Documentation" pages in the Garmin Developer
 *   Portal (the "Apps" section is also where the Client ID/Secret and
 *   the Authorized Callback Domain are registered).
 * - "Delivery: Push only" (per the Starter Access screenshot) means
 *   there is NO pull/poll endpoint for Activity/Health/Training data —
 *   Garmin calls a webhook on OUR side whenever an athlete's device
 *   syncs. See app/api/webhooks/garmin/route.ts — the payload shape
 *   per API family is unconfirmed, so every push is stored raw first
 *   (garmin_push_events) and parsed later once a real payload is seen.
 * - `pushStructuredWorkoutToGarmin()`'s actual Training API endpoint
 *   and request body shape are NOT confirmed either — same "exists so
 *   the UI has a stable interface to call, needs a real rewrite once
 *   the docs are read" caveat already applied to COROS's push function.
 *
 * **Legal constraint this file (and anything built on top of it) must
 * respect**: per Section 15.11 of the Garmin Connect Developer Program
 * Agreement, Garmin Device Sourced Data may NEVER be used as input to
 * any AI model/system — including a single Claude API inference call,
 * under a plain reading of "create or maintain any AI model, AI system
 * ...using Garmin Device Sourced Data." Nothing in this file, or any
 * route built on it, should ever be passed into
 * lib/integrations/claude.ts's generateActivityDescription() or any
 * future AI feature (the planned "AI-generated training plans" /
 * "virtual coach agent" roadmap items). Keep Garmin-sourced data out of
 * any AI prompt, full stop.
 */

function requireGarminDevEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Garmin Developer Program's real API endpoints are unconfirmed in this codebase, see the top of lib/integrations/garminDeveloper.ts.`
    );
  }
  return value;
}

export function buildGarminDevAuthorizeUrl(athleteId: string) {
  const authorizeUrl = requireGarminDevEnv("GARMIN_DEV_AUTHORIZE_URL");
  const clientId = requireGarminDevEnv("GARMIN_DEV_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${getSiteBaseUrl()}/api/garmin-dev/callback`,
    response_type: "code",
    state: athleteId,
  });
  return `${authorizeUrl}?${params.toString()}`;
}

interface GarminDevTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Standard OAuth2 convention (RFC 6749): seconds until expiry from
   * now. Assumed here as the more common shape; not independently
   * confirmed for Garmin's Developer Program specifically. */
  expires_in: number;
  scope?: string;
  /** Guessed field name for Garmin's own athlete/user id in the token
   * response — unconfirmed. */
  user_id?: string;
}

export async function exchangeGarminDevCode(code: string): Promise<GarminDevTokenResponse> {
  const tokenUrl = requireGarminDevEnv("GARMIN_DEV_TOKEN_URL");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GARMIN_DEV_CLIENT_ID ?? "",
      client_secret: process.env.GARMIN_DEV_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: `${getSiteBaseUrl()}/api/garmin-dev/callback`,
    }),
  });
  if (!res.ok) throw new Error(`Garmin Developer token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshGarminDevToken(refreshToken: string): Promise<GarminDevTokenResponse> {
  const tokenUrl = requireGarminDevEnv("GARMIN_DEV_TOKEN_URL");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GARMIN_DEV_CLIENT_ID ?? "",
      client_secret: process.env.GARMIN_DEV_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Garmin Developer token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Same shape as Strava/COROS's getValidAccessToken — refreshes +
 * persists if expiring within 5 minutes, returns null if not connected. */
export async function getValidGarminDevAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data: conn } = await db
    .from("garmin_dev_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!conn) return null;

  const expiresAtMs = new Date(conn.expires_at).getTime();
  if (expiresAtMs - Date.now() > 5 * 60 * 1000) {
    return conn.access_token;
  }

  const refreshed = await refreshGarminDevToken(conn.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await db
    .from("garmin_dev_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("athlete_id", athleteId);
  return refreshed.access_token;
}

/**
 * Maps one Cadencia WorkoutStep to Garmin's Training API shape — pure
 * guesswork at the field names below (no reference found anywhere, unlike
 * COROS's rCoros lead), kept deliberately generic/self-describing so a
 * real rewrite is a small, contained change once the API Reference is
 * actually read. **Not confirmed against official docs.**
 */
function stepToGarminShape(step: WorkoutStep) {
  return {
    stepType: step.kind,
    durationType: step.durationType,
    durationValue: step.durationValue,
    targetType: step.targetType,
    targetLow: step.targetLow,
    targetHigh: step.targetHigh,
    repeatCount: step.repeatCount ?? 1,
  };
}

/**
 * Pushes a structured workout onto the athlete's Garmin account via the
 * Training API. **Unconfirmed end-to-end** — the endpoint path, auth
 * header shape, and request/response body are all placeholders pending
 * the real API Reference (blocked from this sandbox). Exists so
 * POST /api/garmin-dev/push and the "Push to Garmin" button in
 * WorkoutDialog.tsx have a stable interface today; rewrite the body once
 * the docs are read.
 */
export async function pushStructuredWorkoutToGarmin(athleteId: string, workout: Workout): Promise<void> {
  if (!workout.workout_steps.length) {
    throw new Error("This workout has no structured steps to push.");
  }
  const accessToken = await getValidGarminDevAccessToken(athleteId);
  if (!accessToken) throw new Error("This athlete has no Garmin Developer connection.");

  const apiBase = requireGarminDevEnv("GARMIN_DEV_API_BASE");
  const res = await fetch(`${apiBase}/training-api/workout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workoutName: workout.title,
      scheduledDate: workout.date,
      steps: workout.workout_steps.map(stepToGarminShape),
    }),
  });
  if (!res.ok) {
    throw new Error(`Garmin workout push failed: ${res.status} ${await res.text()}`);
  }
}
