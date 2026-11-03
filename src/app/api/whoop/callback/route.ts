import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeWhoopCode, fetchWhoopProfile } from "@/lib/integrations/whoop";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * WHOOP redirects here after the athlete approves (or denies) access.
 * `state` is the athlete's own id, same pattern as Strava's callback
 * (no PKCE in this flow, unlike Garmin's). Register this exact URL as
 * the app's redirect_uri in the WHOOP Developer Dashboard:
 * `https://<this app's domain>/api/whoop/callback`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const athleteId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !athleteId) {
    return NextResponse.redirect(`${base}/settings?whoop=error`);
  }

  try {
    const token = await exchangeWhoopCode(code);
    // Best-effort — the connection is still useful without a cached
    // whoop_user_id, this is just for reference/debugging.
    const profile = await fetchWhoopProfile(token.access_token).catch(() => null);

    const db = createServiceClient();
    await db.from("whoop_connections").upsert(
      {
        athlete_id: athleteId,
        whoop_user_id: profile?.user_id ?? null,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        scope: token.scope ?? null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    return NextResponse.redirect(`${base}/settings?whoop=connected`);
  } catch (e) {
    console.error("WHOOP callback failed", e);
    return NextResponse.redirect(`${base}/settings?whoop=error`);
  }
}
