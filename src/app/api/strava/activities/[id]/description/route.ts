import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getValidAccessToken, updateStravaActivityDescription } from "@/lib/integrations/strava";

/**
 * Lets the signed-in athlete push a description straight onto a synced
 * Strava activity from `ActivityDetailDialog`, not just through a matched
 * workout's "Strava Description" field (built Nov 2026, direct complaint:
 * "no deja poner comentarios en la actividad" — there was no way to set
 * this for an activity like a standalone, unmatched Strava run that has no
 * planned workout to carry a comment at all).
 *
 * If this activity IS already matched to a `workouts` row, that row's own
 * `strava_comment` is updated too (not just pushed to Strava directly) —
 * keeping it as the real source of truth `/api/strava/sync`'s own
 * auto-complete retry already reads from on every future sync, so this
 * edit doesn't get silently overwritten by an AI-drafted description the
 * next time that route runs. `description_written_at` is also stamped so
 * that retry logic doesn't immediately re-describe this same activity.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { description?: string };
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return NextResponse.json({ error: "Description is required." }, { status: 400 });

  const db = createServiceClient();

  const { data: act } = await db.from("strava_activities").select("id").eq("id", id).eq("athlete_id", athlete.id).maybeSingle();
  if (!act) return NextResponse.json({ error: "Activity not found." }, { status: 404 });

  const accessToken = await getValidAccessToken(athlete.id);
  if (!accessToken) return NextResponse.json({ error: "No Strava connection for this athlete." }, { status: 400 });

  try {
    await updateStravaActivityDescription(accessToken, id, description);
  } catch (e) {
    console.error("Failed to push a direct Strava description", id, e);
    return NextResponse.json({ error: "Could not update the activity on Strava." }, { status: 502 });
  }

  // No-ops cleanly if this activity isn't matched to any workout.
  await db.from("workouts").update({ strava_comment: description }).eq("strava_activity_id", id).eq("athlete_id", athlete.id);
  await db.from("strava_activities").update({ description_written_at: new Date().toISOString() }).eq("id", id);

  return NextResponse.json({ ok: true });
}
