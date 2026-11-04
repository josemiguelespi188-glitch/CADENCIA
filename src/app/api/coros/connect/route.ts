import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { buildCorosMcpAuthorizeUrl } from "@/lib/integrations/corosMcp";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/** Same shape as /api/strava/connect — derives the athlete from the
 * signed-in session, redirects to COROS MCP's real authorize URL
 * (discovered live per RFC 9728/8414 — see corosMcp.ts). */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) {
    return NextResponse.redirect(`${getSiteBaseUrl()}/settings?coros=error`);
  }
  try {
    const url = await buildCorosMcpAuthorizeUrl(athlete.id);
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("COROS MCP connect failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start COROS authorization." }, { status: 500 });
  }
}
