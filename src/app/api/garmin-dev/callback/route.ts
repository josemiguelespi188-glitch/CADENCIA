import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeGarminDevCode, fetchGarminUserId } from "@/lib/integrations/garminDeveloper";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * The OAuth redirect URI to register as this app's "Authorized Callback
 * Domain" / redirect_uri in the Garmin Developer Portal's Apps section:
 * `https://cadenciatraining.vercel.app/api/garmin-dev/callback`.
 *
 * Confirmed live (Nov 2026) that Garmin's OAuth 2.0 uses PKCE — `state`
 * here is an opaque random token (not the athlete id directly, unlike
 * Strava/COROS's callbacks), looked up against `garmin_oauth_pkce` to
 * recover both the athlete id and the code_verifier
 * `buildGarminDevAuthorizeUrl()` generated for it. The actual token
 * exchange still needs `GARMIN_DEV_TOKEN_URL` set to a real, confirmed
 * value (see lib/integrations/garminDeveloper.ts's file header) — that
 * one piece is still unconfirmed.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/settings?garmindev=error`);
  }

  const db = createServiceClient();
  const { data: pkce } = await db
    .from("garmin_oauth_pkce")
    .select("athlete_id, code_verifier")
    .eq("state", state)
    .maybeSingle();

  if (!pkce) {
    // Expired, already used, or a forged state — never guess an athlete.
    return NextResponse.redirect(`${base}/settings?garmindev=error`);
  }

  try {
    const token = await exchangeGarminDevCode(code, pkce.code_verifier);
    // Best-effort — see fetchGarminUserId()'s own doc comment for why a
    // failure here must never block the connect itself.
    const garminUserId = await fetchGarminUserId(token.access_token);
    await db.from("garmin_dev_connections").upsert(
      {
        athlete_id: pkce.athlete_id,
        garmin_user_id: garminUserId,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        scope: token.scope,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    await db.from("garmin_oauth_pkce").delete().eq("state", state);
    return NextResponse.redirect(`${base}/settings?garmindev=connected`);
  } catch (e) {
    console.error("Garmin Developer callback failed", e);
    return NextResponse.redirect(`${base}/settings?garmindev=error`);
  }
}
