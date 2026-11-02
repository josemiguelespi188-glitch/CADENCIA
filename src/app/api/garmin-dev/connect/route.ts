import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildGarminDevAuthorizeUrl } from "@/lib/integrations/garminDeveloper";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/** Same shape as /api/strava/connect and /api/coros/connect — derives
 * the athlete from the signed-in session, redirects to Garmin's real
 * authorize URL (endpoint unconfirmed, see lib/integrations/garminDeveloper.ts). */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(`${getSiteBaseUrl()}/settings?garmindev=error`);
  }
  try {
    return NextResponse.redirect(buildGarminDevAuthorizeUrl(athlete.id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Garmin Developer API is not configured yet." },
      { status: 500 }
    );
  }
}
