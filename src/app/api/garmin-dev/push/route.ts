import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { pushStructuredWorkoutToGarmin } from "@/lib/integrations/garminDeveloper";
import type { Workout } from "@/lib/types";

/**
 * Pushes one workout's structured steps to Garmin's Training API. Any
 * signed-in athlete can push any workout (not just their own) — same
 * "shared coach log" openness as /api/coros/push, since the workout
 * being pushed may belong to a teammate being coached. **Will almost
 * certainly fail** until Garmin's real Training API payload shape is
 * confirmed and configured — see
 * lib/integrations/garminDeveloper.ts's file header.
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
    await pushStructuredWorkoutToGarmin((workout as Workout).athlete_id, workout as Workout);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Garmin push failed." }, { status: 500 });
  }
}
