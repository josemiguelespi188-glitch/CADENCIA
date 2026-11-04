import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Surfaces `coros_connections.tools_catalog` — the real MCP `tools/list`
 * response captured automatically on connect (see
 * lib/integrations/corosMcp.ts's `captureCorosToolCatalog`) — so the real
 * `course` payload schema can be read directly from the Settings UI
 * instead of needing SQL Editor access. This is a debug/development
 * surface, not a feature for every athlete to use day to day: once this
 * schema is reviewed and `pushStructuredWorkoutToCorosMcp()` is actually
 * built, this route can stay (harmless) or be removed.
 */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = createServiceClient();
  const { data } = await db
    .from("coros_connections")
    .select("tools_catalog, tools_captured_at")
    .eq("athlete_id", athlete.id)
    .maybeSingle();

  return NextResponse.json({
    toolsCatalog: data?.tools_catalog ?? null,
    capturedAt: data?.tools_captured_at ?? null,
  });
}
