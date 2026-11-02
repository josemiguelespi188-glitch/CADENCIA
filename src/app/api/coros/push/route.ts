import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { pushStructuredWorkoutToCoros } from "@/lib/integrations/coros";
import type { Workout } from "@/lib/types";

/**
 * Pushes one workout's structured steps to COROS. Any signed-in athlete
 * can push any workout (not just their own) — same "shared coach log"
 * openness as editing/deleting a workout already has (see CLAUDE.md's
 * "Data model & auth" note), not scoped to "my own COROS connection"
 * the way Strava connect/sync is, since the workout being pushed may
 * belong to a teammate being coached. **Will almost certainly fail**
 * until COROS's real API is confirmed and configured — see
 * lib/integrations/coros.ts's file header.
 */
export async function POST(req: NextRequest) {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { workoutId } = await req.json().catch(() => ({}));
  if (!workoutId) return NextResponse.json({ error: "workoutId is required." }, { status: 400 });

  const db = createServiceClient();
  const { data: workout } = await db.from("workouts").select("*").eq("id", workoutId).maybeSingle();
  if (!workout) return NextResponse.json({ error: "Workout not found." }, { status: 404 });

  try {
    await pushStructuredWorkoutToCoros((workout as Workout).athlete_id, workout as Workout);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "COROS push failed." }, { status: 500 });
  }
}
