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
 * - **Confirmed live (Nov 2026) via Garmin's own "OAuth2 Tools"
 *   interactive walkthrough that this is OAuth 2.0 with PKCE**
 *   (code_verifier/code_challenge/S256) — not a plain authorization
 *   code grant. `buildGarminDevAuthorizeUrl()` generates the verifier,
 *   stashes it server-side in `garmin_oauth_pkce` keyed by a random
 *   `state` (the athlete's id is no longer the state value itself —
 *   state is now an opaque random token, looked up to get both the
 *   athlete id and the code_verifier back in the callback), and
 *   `exchangeGarminDevCode()` sends it back as `code_verifier` in the
 *   token request, per the walkthrough's own step 4.
 * - **Authorize URL confirmed**: `https://connect.garmin.com/oauth2Confirm`
 *   — read directly from the walkthrough's own "Build the Authorization
 *   URL" step, which showed the exact query params used
 *   (`client_id`, `response_type=code`, `state`, `redirect_uri`,
 *   `code_challenge`, `code_challenge_method=S256` — no `scope` param;
 *   scope appears to be derived server-side from the app's selected
 *   APIs, not something passed here).
 * - **Token response shape confirmed** from the same walkthrough's
 *   step 4 result: `access_token`, `refresh_token`, `token_type:
 *   "bearer"`, `scope` (a space-separated string, e.g. "PARTNER_WRITE
 *   PARTNER_READ CONNECT_READ CONNECT_WRITE"), `jti` (unused),
 *   `expires_in`, and `refresh_token_expires_in` (refresh tokens also
 *   expire — ~90 days seen live — not tracked separately here since
 *   Cadencia only ever refreshes the access token proactively; a
 *   fully-expired refresh token would surface as a failed refresh,
 *   requiring the athlete to reconnect). **No `user_id` field in the
 *   real response** — the earlier guessed optional field was removed;
 *   `garmin_user_id` is left null for now. The confirmed Partner API
 *   spec does have a `GET /partner-gateway/rest/user/id` endpoint that
 *   could populate it later if needed.
 * - **Token URL is still NOT confirmed** — the walkthrough's step 4
 *   didn't show a "Base URL" the way step 2 did; `GARMIN_DEV_TOKEN_URL`
 *   stays a required env var with no guessed default.
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
 * - **`pushStructuredWorkoutToGarmin()`'s request shape** — two calls,
 *   not one: create the `Workout`, then assign it to a date
 *   (`WorkoutSchedule`). The exact URLs have needed two live-tested
 *   fixes so far (Nov 2026), both from the same symptom: a POST that
 *   should hit a "create" endpoint instead got routed to the
 *   single-resource-by-id endpoint (`405 "This endpoint supports
 *   'DELETE', 'GET', 'PUT'"`) — meaning naive concatenation onto the
 *   spec's documented `servers.url` doesn't reliably reach the real
 *   create routes:
 *   1. `POST {API_BASE}/training-api/workout` creates a `Workout` —
 *      fixed from the spec's literal `servers.url + "/workout"` (which
 *      duplicated the base's own trailing `/workout` segment and 405'd).
 *   2. `POST {API_BASE}/training-api/schedule` creates a
 *      `WorkoutSchedule` (`{workoutId, date}`) — **also fixed, same
 *      symptom**: `{API_BASE}/training-api/workout/schedule` (naive
 *      concatenation, matching the spec's `servers.url + "/schedule"`
 *      literally) 405'd the same way even though it has no literal
 *      duplicate segment, which suggests the real router treats ANY
 *      path appended onto `.../training-api/workout` as the
 *      by-id resource regardless of its content — so `/schedule`'s
 *      real endpoint was guessed to live outside that base entirely,
 *      as its own sibling resource directly under `/training-api/`.
 *      **This second fix is NOT yet confirmed live** — if it still
 *      404s/405s, the schedule endpoint's real location needs to come
 *      from the portal's own docs rather than another guess.
 *   This same trap may also affect Course Portal if it's ever built
 *   (its `servers.url` similarly ends in a segment, `/courses`, that
 *   its own paths start with again) — verify live, don't assume this
 *   specific pattern repeats there. `Step.type` is a discriminator: `"WorkoutStep"`
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

/** Base64url encoding (RFC 4648 §5) — no padding, `+`/`/` swapped for
 * `-`/`_`. Used for both the PKCE code_verifier and code_challenge. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A cryptographically random, URL-safe string — used both as the PKCE
 * code_verifier (its base64url alphabet is a valid subset of the
 * verifier's allowed charset, A-Z a-z 0-9 -._~) and as the opaque
 * `state` value. */
function randomUrlSafeString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** PKCE code_challenge = BASE64URL(SHA256(code_verifier)), per RFC 7636
 * and confirmed against Garmin's own "OAuth2 Tools" walkthrough. */
async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Builds Garmin's authorize URL and stashes the PKCE code_verifier
 * server-side (keyed by a random `state`) so it survives the round trip
 * to Garmin's consent screen and back — see this file's header for how
 * this was confirmed. Async because it writes that row before
 * returning the URL to redirect to.
 */
export async function buildGarminDevAuthorizeUrl(athleteId: string): Promise<string> {
  const authorizeUrl = requireGarminDevEnv("GARMIN_DEV_AUTHORIZE_URL");
  const clientId = requireGarminDevEnv("GARMIN_DEV_CLIENT_ID");

  const codeVerifier = randomUrlSafeString(64);
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier);
  const state = randomUrlSafeString(32);

  const db = createServiceClient();
  const { error } = await db.from("garmin_oauth_pkce").insert({ state, athlete_id: athleteId, code_verifier: codeVerifier });
  if (error) throw new Error(`Could not start Garmin connect: ${error.message}`);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    state,
    redirect_uri: `${getSiteBaseUrl()}/api/garmin-dev/callback`,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authorizeUrl}?${params.toString()}`;
}

interface GarminDevTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Space-separated scope string, e.g. "PARTNER_WRITE PARTNER_READ
   * CONNECT_READ CONNECT_WRITE" — confirmed live. */
  scope: string;
  expires_in: number;
  /** Confirmed live: refresh tokens expire too (~90 days seen) — not
   * separately tracked here, see this file's header. */
  refresh_token_expires_in: number;
}

/** `codeVerifier` is the one generated in `buildGarminDevAuthorizeUrl()`
 * for this same `state`, looked up by the callback route. */
export async function exchangeGarminDevCode(code: string, codeVerifier: string): Promise<GarminDevTokenResponse> {
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
      code_verifier: codeVerifier,
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

  try {
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
  } catch (e) {
    // Same concurrent-refresh race already fixed in strava.ts — see its
    // getValidAccessToken for the full rationale.
    const { data: latest } = await db
      .from("garmin_dev_connections")
      .select("access_token, expires_at")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (latest && new Date(latest.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      return latest.access_token;
    }
    throw e;
  }
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

  const createRes = await fetch(`${apiBase}/training-api/workout`, {
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

  const scheduleRes = await fetch(`${apiBase}/training-api/schedule`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workoutId: created.workoutId, date: workout.date }),
  });
  if (!scheduleRes.ok) {
    throw new Error(`Garmin workout was created but scheduling it failed: ${scheduleRes.status} ${await scheduleRes.text()}`);
  }
}

/**
 * Resolves this connection's real Garmin "Connect Developer User ID" —
 * confirmed in the real Partner API OpenAPI spec as
 * `GET {API_BASE}/partner-gateway/rest/user/id` -> `{userId: string}`.
 * This is the one piece this codebase was missing to attribute an
 * incoming Health/Activity push to a Cadencia athlete at all: every
 * `Client*` push payload (ClientSleep, ClientHRVSummary, etc.) carries
 * its own `userId`, which only means something once we know which
 * athlete that Garmin user id belongs to. Called right after a fresh
 * token exchange in the OAuth callback — **not independently confirmed
 * live from this sandbox** (same caution as the Workout Portal's
 * /schedule fix above: the spec says this path, but Garmin's real
 * router has already surprised this codebase once with a naive
 * concatenation). Best-effort: a failure here must never fail the
 * OAuth connect itself, since the Training-API push flow doesn't need
 * this id at all — only incoming Health pushes do.
 */
export async function fetchGarminUserId(accessToken: string): Promise<string | null> {
  try {
    const apiBase = requireGarminDevEnv("GARMIN_DEV_API_BASE");
    const res = await fetch(`${apiBase}/partner-gateway/rest/user/id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(`Garmin user/id lookup failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const body: { userId?: string } = await res.json();
    return body.userId ?? null;
  } catch (e) {
    console.error("Garmin user/id lookup threw", e);
    return null;
  }
}
