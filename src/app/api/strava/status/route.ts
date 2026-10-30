import { NextRequest, NextResponse } from "next/server";
import { getAthleteBySlug } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * strava_connections has RLS enabled with no policies at all (service-role
 * only — it holds real OAuth tokens), so the Settings page can't read it
 * directly from the browser. This route reads it server-side with the
 * service client and returns only the non-secret bits the UI needs, for
 * the athlete named in `?athlete=juan|jose`.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("athlete");
  const athlete = slug ? await getAthleteBySlug(slug) : null;
  if (!athlete) return NextResponse.json({ error: "Unknown athlete" }, { status: 400 });

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
