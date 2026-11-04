import { NextRequest, NextResponse } from "next/server";
import { handleCorosMcpCallback } from "@/lib/integrations/corosMcp";
import { getSiteBaseUrl } from "@/lib/integrations/strava";

/**
 * Redirect URI for COROS MCP's real OAuth flow — registered dynamically
 * (RFC 7591) rather than pasted into a developer portal, so there's no
 * manual registration step to keep in sync with this URL. See
 * lib/integrations/corosMcp.ts.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = getSiteBaseUrl();

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/settings?coros=error`);
  }

  try {
    await handleCorosMcpCallback(code, state);
    return NextResponse.redirect(`${base}/settings?coros=connected`);
  } catch (e) {
    console.error("COROS MCP callback failed", e);
    return NextResponse.redirect(`${base}/settings?coros=error`);
  }
}
