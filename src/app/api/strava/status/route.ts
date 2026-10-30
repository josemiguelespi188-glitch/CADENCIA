import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * strava_connections has RLS enabled with no policies at all (service-role
 * only — it holds real OAuth tokens), so Settings can't read it directly
 * from the browser. Always the SIGNED-IN athlete's own connection now —
 * see the note in connect/route.ts.
 */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = createServiceClient();
  const { data } = await db
    .from("strava_connections")
    .select("connected_at, last_synced_at")
    .eq("athlete_id", athlete.id)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    connectedAt: data?.connected_at ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
  });
}
