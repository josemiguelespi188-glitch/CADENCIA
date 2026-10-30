import { NextRequest, NextResponse } from "next/server";
import { getAthleteBySlug } from "@/lib/auth";
import { buildStravaAuthorizeUrl, getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * Starts the OAuth round trip for the athlete named in `?athlete=juan|jose`
 * — auth is off for now, so there's no signed-in session to derive this
 * from; the Settings page passes it explicitly instead (see lib/auth.ts).
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("athlete");
  const athlete = slug ? await getAthleteBySlug(slug) : null;
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
