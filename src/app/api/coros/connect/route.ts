import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildCorosAuthorizeUrl } from "@/lib/integrations/coros";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/** Same shape as /api/strava/connect — derives the athlete from the
 * signed-in session, redirects to COROS's authorize URL (real endpoint
 * unconfirmed, see lib/integrations/coros.ts). */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(`${getSiteBaseUrl()}/settings?coros=error`);
  }
  try {
    return NextResponse.redirect(buildCorosAuthorizeUrl(athlete.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "COROS is not configured yet." }, { status: 500 });
  }
}
