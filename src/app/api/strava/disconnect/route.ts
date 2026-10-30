import { NextRequest, NextResponse } from "next/server";
import { getAthleteBySlug } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { athleteSlug } = await req.json().catch(() => ({ athleteSlug: null }));
  const athlete = athleteSlug ? await getAthleteBySlug(athleteSlug) : null;
  if (!athlete) return NextResponse.json({ error: "Unknown athlete" }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.from("strava_connections").delete().eq("athlete_id", athlete.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
