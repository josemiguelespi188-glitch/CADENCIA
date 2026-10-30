import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildStravaAuthorizeUrl } from "@/lib/integrations/strava";

/**
 * Starts the OAuth round trip for the signed-in athlete's OWN Strava
 * account — each athlete connects their own, per product decision. There's
 * no athlete picker here on purpose: this always acts on whoever is
 * currently signed in, never on a different athlete passed in the request.
 */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(new URL("/auth", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"));
  }
  if (!process.env.STRAVA_CLIENT_ID) {
    return NextResponse.json(
      { error: "STRAVA_CLIENT_ID is not set. See .env.example / CLAUDE.md." },
      { status: 500 }
    );
  }
  return NextResponse.redirect(buildStravaAuthorizeUrl(athlete.id));
}
