import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildWhoopAuthorizeUrl } from "@/lib/integrations/whoop";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/** Mirrors /api/strava/connect exactly — derives the athlete from the
 * signed-in session, not a client-supplied slug. See
 * lib/integrations/whoop.ts's file header for the OAuth flow this starts. */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(`${getSiteBaseUrl()}/settings?whoop=error`);
  }
  if (!process.env.WHOOP_CLIENT_ID) {
    return NextResponse.json({ error: "WHOOP_CLIENT_ID is not set. See .env.example / CLAUDE.md." }, { status: 500 });
  }
  return NextResponse.redirect(buildWhoopAuthorizeUrl(athlete.id));
}
