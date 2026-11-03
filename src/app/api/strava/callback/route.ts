import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeStravaCode, getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * Strava redirects here after the athlete approves (or denies) access.
 * `state` is the athlete's own id, set when /api/strava/connect built the
 * authorize URL — this is how we know which athlete just connected, since
 * this is a fresh top-level navigation with no session context of its own
 * to rely on.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const athleteId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !athleteId) {
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }

  try {
    const token = await exchangeStravaCode(code);
    if (!token.athlete?.id) throw new Error("Strava did not return an athlete id");

    const db = createServiceClient();
    const { error: upsertError } = await db.from("strava_connections").upsert(
      {
        athlete_id: athleteId,
        strava_athlete_id: token.athlete.id,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(token.expires_at * 1000).toISOString(),
        scope: "read,activity:read_all",
        connected_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    // Found live (Nov 2026, full codebase audit): same unchecked-upsert
    // bug class already fixed in whoop/callback.
    if (upsertError) {
      console.error("Strava connection upsert failed", upsertError);
      return NextResponse.redirect(`${base}/settings?strava=error`);
    }
    return NextResponse.redirect(`${base}/settings?strava=connected`);
  } catch (e) {
    console.error("Strava callback failed", e);
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }
}
