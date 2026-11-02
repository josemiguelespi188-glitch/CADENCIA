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
 *   syncs. See app/api/webhooks/garmin/[type]/route.ts — the payload
 *   shape per API family is still unconfirmed, so every push is stored
 *   raw first (garmin_push_events) and parsed later once a real
 *   payload is seen.
 * - **`GARMIN_DEV_API_BASE` is confirmed**: `https://apis.garmin.com`
 *   — read directly off the real OpenAPI specs' `servers.url` (Partner
 *   API `/partner-gateway`, Workout Portal `/training-api/workout`,
 *   Health API `/wellness-api`, Course Portal `/training-api/courses`
 *   — each family under the same host, different sub-path), via the
 *   portal's own "API Documentation" page (Nov 2026). The
 *   authorize/token URLs are still NOT confirmed — neither appears in
 *   any of those specs (they're all data APIs, not the OAuth server
 *   itself); get those from "OAuth2 Tools" -> "User Authorization" /
 *   "Refresh Token" specifically.
 * - **`pushStructuredWorkoutToGarmin()`'s request shape is now
 *   confirmed**, against the real Workout Portal OpenAPI spec (not a
 *   guess anymore): `POST {API_BASE}/training-api/workout/workout`
 *   creates a `Workout` (server base already includes
 *   `/training-api/workout`, the path adds another `/workout` on top —
 *   that double segment is exactly what the real spec shows, not a
 *   typo), then `POST {API_BASE}/training-api/workout/schedule` with
 *   `{workoutId, date}` assigns it to a calendar date (`WorkoutSchedule`).
 *   Two calls, not one. `Step.type` is a discriminator: `"WorkoutStep"`
 *   for a plain step or `"WorkoutRepeatStep"` for a repeat marker.
 *   **Still a real simplification**: the confirmed schema has no
 *   nested "child steps of a repeat" field on `WorkoutRepeatStep`
 *   itself (only `repeatType`/`repeatValue`/`skipLastRestStep`), so how
 *   grouping actually works (presumably via `stepOrder` adjacency) isn't
 *   confirmed from this spec alone — rather than guess that semantics,
 *   a Cadencia step with `repeatCount > 1` is sent as that many
 *   duplicate `WorkoutStep` entries in sequence instead of one
 *   `WorkoutRepeatStep` wrapper. Functionally equivalent for the
 *   athlete, just not using Garmin's native repeat-block UI grouping.
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

/** Cadencia's Sport -> Garmin's confirmed Workout.sport enum
 * (RUNNING/CYCLING/LAP_SWIMMING/STRENGTH_TRAINING/CARDIO_TRAINING/YOGA/
 * PILATES/GENERIC/HIIT/MULTI_SPORT). Cadencia has no "race" equivalent —
 * GENERIC is the safest fallback, not a guess at a closer-but-wrong enum
 * value. */
function sportToGarminShape(sport: Workout["sport"]): string {
  switch (sport) {
    case "run":
      return "RUNNING";
    case "bike":
      return "CYCLING";
    case "swim":
      return "LAP_SWIMMING";
    case "gym":
      return "STRENGTH_TRAINING";
    case "race":
      return "GENERIC";
    default:
      return "GENERIC";
  }
}

/** Cadencia's WorkoutStepKind -> Garmin's confirmed WorkoutStep.intensity
 * enum (ACTIVE/REST/WARMUP/COOLDOWN/RECOVERY/INTERVAL/MAIN). */
function kindToGarminIntensity(kind: WorkoutStep["kind"]): string {
  switch (kind) {
    case "warmup":
      return "WARMUP";
    case "work":
      return "INTERVAL";
    case "recovery":
      return "RECOVERY";
    case "cooldown":
      return "COOLDOWN";
    case "rest":
      return "REST";
  }
}

/** Cadencia's WorkoutStepDurationType -> Garmin's confirmed
 * WorkoutStep.durationType enum (a much larger real enum; only the 3
 * values Cadencia's own model can produce are mapped). */
function durationTypeToGarminShape(durationType: WorkoutStep["durationType"]): string {
  switch (durationType) {
    case "time":
      return "TIME";
    case "distance":
      return "DISTANCE";
    case "open":
      return "OPEN";
  }
}

/** Cadencia's WorkoutStepTargetType -> Garmin's confirmed
 * WorkoutStep.targetType enum. */
function targetTypeToGarminShape(targetType: WorkoutStep["targetType"]): string {
  switch (targetType) {
    case "pace":
      return "PACE";
    case "hr":
      return "HEART_RATE";
    case "power":
      return "POWER";
    case "cadence":
      return "CADENCE";
    case "open":
      return "OPEN";
  }
}

/**
 * Maps one Cadencia WorkoutStep to a real Garmin `WorkoutStep` object,
 * per the confirmed Workout Portal OpenAPI schema (Nov 2026) — field
 * names and enum values below are no longer a guess. `repeatCount > 1`
 * duplicates the step that many times (see this file's header for why
 * a native `WorkoutRepeatStep` wrapper isn't attempted).
 */
function stepToGarminShape(step: WorkoutStep, stepOrder: number) {
  return {
    stepOrder,
    type: "WorkoutStep",
    intensity: kindToGarminIntensity(step.kind),
    durationType: durationTypeToGarminShape(step.durationType),
    durationValue: step.durationValue,
    targetType: targetTypeToGarminShape(step.targetType),
    targetValue: step.targetLow,
    targetValueLow: step.targetLow,
    targetValueHigh: step.targetHigh,
  };
}

function buildGarminSteps(steps: WorkoutStep[]) {
  const expanded: WorkoutStep[] = [];
  for (const step of steps) {
    const times = Math.max(1, step.repeatCount ?? 1);
    for (let i = 0; i < times; i++) expanded.push(step);
  }
  return expanded.map((step, i) => stepToGarminShape(step, i + 1));
}

interface GarminWorkoutCreateResponse {
  workoutId: number;
}

/**
 * Pushes a structured workout onto the athlete's Garmin account via the
 * Training API — two confirmed calls (see this file's header): create
 * the `Workout`, then create a `WorkoutSchedule` assigning it to
 * `workout.date`. The request shape is now confirmed against the real
 * Workout Portal OpenAPI spec; the response shape for errors beyond a
 * non-2xx status is not specially parsed.
 */
export async function pushStructuredWorkoutToGarmin(athleteId: string, workout: Workout): Promise<void> {
  if (!workout.workout_steps.length) {
    throw new Error("This workout has no structured steps to push.");
  }
  const accessToken = await getValidGarminDevAccessToken(athleteId);
  if (!accessToken) throw new Error("This athlete has no Garmin Developer connection.");

  const apiBase = requireGarminDevEnv("GARMIN_DEV_API_BASE");
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  const createRes = await fetch(`${apiBase}/training-api/workout/workout`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workoutName: workout.title,
      sport: sportToGarminShape(workout.sport),
      steps: buildGarminSteps(workout.workout_steps),
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Garmin workout creation failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created: GarminWorkoutCreateResponse = await createRes.json();

  const scheduleRes = await fetch(`${apiBase}/training-api/workout/schedule`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workoutId: created.workoutId, date: workout.date }),
  });
  if (!scheduleRes.ok) {
    throw new Error(`Garmin workout was created but scheduling it failed: ${scheduleRes.status} ${await scheduleRes.text()}`);
  }
}
