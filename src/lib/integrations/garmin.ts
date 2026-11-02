import { createServiceClient } from "@/lib/supabase/server";

/**
 * Garmin Connect **Personal API** — deliberately different from
 * `lib/integrations/coros.ts`'s OAuth model. This API is a long-lived,
 * self-generated key an athlete creates for THEMSELVES at
 * https://connect.garmin.com/app/settings/personalApiToken — Garmin's
 * own documentation states it's "meant for individual Garmin users who
 * want programmatic access to their own data... not intended for
 * commercial applications serving multiple end users." That's exactly
 * why this is built as "each athlete pastes in their own key, to read
 * their own data" rather than something Cadencia uses to act on an
 * athlete's behalf — a Garmin "Training API" capable of push exists
 * only in Garmin's paid Starter/Enterprise business tier, the same kind
 * of formal partner application already in progress for COROS (see
 * CLAUDE.md's COROS research note); this Personal API cannot do that,
 * full stop (it's explicitly pull-only, read-only).
 *
 * The token-exchange endpoint/header below were found via web search of
 * Garmin's own developer FAQ page content (developer.garmin.com is
 * blocked from this sandbox, so it was never read directly) plus a
 * community MCP server using the identical pattern — meaningfully more
 * confirmed than COROS's endpoints, but still not verified firsthand.
 * The actual DATA endpoints (e.g. "list my activities") were NOT found
 * anywhere with confidence — Garmin publishes no public spec for them,
 * every source describes them as private/undocumented web-app internals
 * that can change without notice. **No data-fetching function is built
 * here for that reason** — only key storage + the token exchange, which
 * doubles as "does this key actually work" validation at connect time.
 */

const GARMIN_TOKEN_EXCHANGE_URL =
  "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";

interface GarminTokenResult {
  accessToken: string;
  expiresAt: string;
}

/**
 * Exchanges a Personal API key for a short-lived (~24h, no refresh
 * token — Garmin's own FAQ: "Garmin does not issue refresh tokens")
 * bearer access token. Also serves as live validation of the key at
 * connect time — an invalid/expired key fails here with a clear error
 * rather than being stored blind.
 */
export async function exchangeGarminPersonalKey(apiKey: string): Promise<GarminTokenResult> {
  const res = await fetch(GARMIN_TOKEN_EXCHANGE_URL, {
    method: "POST",
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Garmin rejected this key: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  // The exact response field name wasn't found in any primary source —
  // only a third-party client reading `access_token`. Tried defensively
  // in likely order rather than assuming one is definitely right.
  const token = data.access_token ?? data.accessToken ?? data.token;
  if (!token || typeof token !== "string") {
    throw new Error(`Garmin token exchange succeeded but the response shape was unexpected: ${JSON.stringify(data)}`);
  }
  // Garmin doesn't appear to return an explicit expiry in the response
  // (not confirmed either way) — assumed ~24h per the documented
  // lifetime, refreshed proactively with an hour of margin below.
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  return { accessToken: token, expiresAt };
}

/** Validates a key works, without persisting anything — used by the
 * connect route before saving. */
export async function validateGarminPersonalKey(apiKey: string): Promise<void> {
  await exchangeGarminPersonalKey(apiKey);
}

/**
 * Returns a valid bearer token for this athlete's stored Garmin key,
 * re-exchanging and caching when missing or expiring within the hour —
 * same shape as Strava/COROS's getValidAccessToken, just re-deriving
 * from a long-lived key instead of a refresh token (Garmin issues none).
 * Returns null if the athlete has no Garmin connection at all.
 */
export async function getValidGarminAccessToken(athleteId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data: conn } = await db
    .from("garmin_connections")
    .select("personal_api_key, access_token, access_token_expires_at")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!conn) return null;

  if (conn.access_token && conn.access_token_expires_at) {
    const expiresAtMs = new Date(conn.access_token_expires_at).getTime();
    if (expiresAtMs - Date.now() > 60 * 60 * 1000) {
      return conn.access_token;
    }
  }

  const { accessToken, expiresAt } = await exchangeGarminPersonalKey(conn.personal_api_key);
  await db
    .from("garmin_connections")
    .update({ access_token: accessToken, access_token_expires_at: expiresAt })
    .eq("athlete_id", athleteId);
  return accessToken;
}

// No data-fetching function (e.g. "list recent activities") is exported
// from this file — see the file header for why. Build one only after
// confirming a real data endpoint path, the same way every other
// unconfirmed-API caveat in this codebase is handled.
