import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeGarminDevCode } from "@/lib/integrations/garminDeveloper";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * The OAuth redirect URI to register as this app's "Authorized Callback
 * Domain" / redirect_uri in the Garmin Developer Portal's Apps section:
 * `https://cadenciatraining.vercel.app/api/garmin-dev/callback`. The
 * actual token exchange inside `exchangeGarminDevCode()` is built
 * against unconfirmed endpoints (see
 * lib/integrations/garminDeveloper.ts's file header) and will fail with
 * a clear error until `GARMIN_DEV_TOKEN_URL`/`GARMIN_DEV_CLIENT_ID`/
 * `GARMIN_DEV_CLIENT_SECRET` are set to real, confirmed values. Same
 * `state`-carries-the-athlete-id pattern as Strava/COROS's callbacks.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const athleteId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !athleteId) {
    return NextResponse.redirect(`${base}/settings?garmindev=error`);
  }

  try {
    const token = await exchangeGarminDevCode(code);
    const db = createServiceClient();
    await db.from("garmin_dev_connections").upsert(
      {
        athlete_id: athleteId,
        garmin_user_id: token.user_id ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        scope: token.scope ?? null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    return NextResponse.redirect(`${base}/settings?garmindev=connected`);
  } catch (e) {
    console.error("Garmin Developer callback failed", e);
    return NextResponse.redirect(`${base}/settings?garmindev=error`);
  }
}
