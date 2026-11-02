import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Same shape as /api/strava/status — service-role read, never exposes tokens. */
export async function GET() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = createServiceClient();
  const { data } = await db
    .from("coros_connections")
    .select("connected_at, last_synced_at")
    .eq("athlete_id", athlete.id)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    connectedAt: data?.connected_at ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
  });
}
