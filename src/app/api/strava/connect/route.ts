import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildStravaAuthorizeUrl, getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * Starts the OAuth round trip for the SIGNED-IN athlete — derived from the
 * session now that real auth is back (see CLAUDE.md's "Real auth + admin"
 * section), not a client-supplied `?athlete=` slug. Closes the old gap
 * where nothing stopped one athlete from clicking Connect on another's
 * card.
 */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(`${getSiteBaseUrl()}/settings?strava=error`);
  }
  if (!process.env.STRAVA_CLIENT_ID) {
    return NextResponse.json(
      { error: "STRAVA_CLIENT_ID is not set. See .env.example / CLAUDE.md." },
      { status: 500 }
    );
  }
  return NextResponse.redirect(buildStravaAuthorizeUrl(athlete.id));
}
