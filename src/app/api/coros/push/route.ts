import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { pushStructuredWorkoutToCorosMcp } from "@/lib/integrations/corosMcp";
import type { Workout } from "@/lib/types";

/**
 * Pushes one workout's structured steps to COROS's real training
 * schedule (`createScheduledWorkout`, now built against the real
 * confirmed schema — see lib/integrations/corosMcp.ts's file header).
 * Same "shared coach log" openness as /api/garmin-dev/push: any
 * signed-in athlete can push any workout, not just their own, since the
 * workout being pushed may belong to a teammate being coached — it
 * always pushes to the WORKOUT'S OWN athlete's COROS connection, not
 * necessarily the caller's.
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
    await pushStructuredWorkoutToCorosMcp((workout as Workout).athlete_id, workout as Workout);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "COROS push failed." }, { status: 500 });
  }
}
