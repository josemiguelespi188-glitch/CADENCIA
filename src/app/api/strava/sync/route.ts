import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchRecentStravaActivities, getValidAccessToken, mapStravaSportType } from "@/lib/integrations/strava";

/**
 * Pulls the signed-in athlete's own recent Strava activities and upserts
 * them into `strava_activities`. Deliberately does not try to auto-link an
 * activity to a specific planned `workouts` row — matching by date+sport
 * alone is guesswork (two easy runs on the same day, a workout logged a day
 * off, etc.), so V1 just shows the real activity alongside the plan on the
 * calendar/dashboard and leaves linking to a future pass if it's wanted.
 */
export async function POST() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const accessToken = await getValidAccessToken(athlete.id);
  if (!accessToken) {
    return NextResponse.json({ error: "No Strava connection for this athlete." }, { status: 400 });
  }

  const activities = await fetchRecentStravaActivities(accessToken, 50);
  const db = createServiceClient();

  const rows = activities.map((a) => ({
    id: String(a.id),
    athlete_id: athlete.id,
    name: a.name,
    sport_type: a.sport_type,
    start_date: a.start_date,
    moving_time_s: a.moving_time,
    distance_m: a.distance,
    average_cadence: a.average_cadence ?? null,
    average_speed: a.average_speed ?? null,
    raw: a,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await db.from("strava_activities").upsert(rows, { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db
    .from("strava_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("athlete_id", athlete.id);

  return NextResponse.json({
    ok: true,
    synced: rows.length,
    mappedSports: rows.map((r) => mapStravaSportType(r.sport_type)),
  });
}
