import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeCorosCode } from "@/lib/integrations/coros";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * This is the endpoint referenced as the OAuth 2.0 Redirect URI in the
 * COROS Partner API application
 * (`https://cadenciatraining.vercel.app/api/coros/callback`) — it now
 * really exists and will accept a redirect, but the actual token exchange
 * inside `exchangeCorosCode()` is built against unconfirmed endpoints
 * (see lib/integrations/coros.ts's file header) and will fail with a
 * clear error until `COROS_TOKEN_URL`/`COROS_CLIENT_ID`/
 * `COROS_CLIENT_SECRET` are set to real, confirmed values. Same `state`-
 * carries-the-athlete-id pattern as Strava's callback.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const athleteId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !athleteId) {
    return NextResponse.redirect(`${base}/settings?coros=error`);
  }

  try {
    const token = await exchangeCorosCode(code);
    const db = createServiceClient();
    await db.from("coros_connections").upsert(
      {
        athlete_id: athleteId,
        coros_athlete_id: token.athlete_id ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    return NextResponse.redirect(`${base}/settings?coros=connected`);
  } catch (e) {
    console.error("COROS callback failed", e);
    return NextResponse.redirect(`${base}/settings?coros=error`);
  }
}
