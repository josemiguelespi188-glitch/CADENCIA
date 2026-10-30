import { NextRequest, NextResponse } from "next/server";
import { getAthleteBySlug } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchRecentStravaActivities,
  fetchStravaAthleteZones,
  getValidAccessToken,
  updateStravaActivityDescription,
} from "@/lib/integrations/strava";
import { mapStravaSportType } from "@/lib/sport";
import { generateActivityDescription } from "@/lib/integrations/claude";
import type { StravaActivity, Workout } from "@/lib/types";

/**
 * Pulls the named athlete's recent Strava activities, upserts them into
 * `strava_activities`, then runs auto-complete + the AI description
 * write-back for any activity not yet processed (`description_written_at
 * is null`) — see CLAUDE.md's "Strava integration" / roadmap sections for
 * the full rationale behind both pieces below.
 */
export async function POST(req: NextRequest) {
  const { athleteSlug } = await req.json().catch(() => ({ athleteSlug: null }));
  const athlete = athleteSlug ? await getAthleteBySlug(athleteSlug) : null;
  if (!athlete) return NextResponse.json({ error: "Unknown athlete" }, { status: 400 });

  const accessToken = await getValidAccessToken(athlete.id);
  if (!accessToken) {
    return NextResponse.json({ error: "No Strava connection for this athlete." }, { status: 400 });
  }

  const activities = await fetchRecentStravaActivities(accessToken, 30);
  const db = createServiceClient();

  const rows = activities.map((a) => ({
    id: String(a.id),
    athlete_id: athlete.id,
    name: a.name,
    sport_type: a.sport_type,
    start_date: a.start_date,
    local_date: a.start_date_local.slice(0, 10),
    moving_time_s: a.moving_time,
    distance_m: a.distance,
    average_cadence: a.average_cadence ?? null,
    average_speed: a.average_speed ?? null,
    average_heart_rate: a.average_heartrate ?? null,
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

  // Pull whatever zones the athlete has configured in Strava itself —
  // best-effort, most athletes never set this up there, so null is the
  // common case and /settings falls back to the manually-entered
  // thresholds (see CLAUDE.md's "Strava zones" note).
  try {
    const zones = await fetchStravaAthleteZones(accessToken);
    await db
      .from("athletes")
      .update({
        strava_hr_zones: zones?.heart_rate?.zones ?? null,
        strava_power_zones: zones?.power?.zones ?? null,
        strava_zones_synced_at: new Date().toISOString(),
      })
      .eq("id", athlete.id);
  } catch (e) {
    console.error("Failed to fetch Strava athlete zones", e);
  }

  // Auto-complete + AI write-back for anything not processed yet — not
  // just this batch, so a prior failed attempt (e.g. Claude was briefly
  // down) gets retried on the next sync too.
  const { data: pending } = await db
    .from("strava_activities")
    .select("*")
    .eq("athlete_id", athlete.id)
    .is("description_written_at", null)
    .limit(200);

  let matched = 0;
  let described = 0;

  for (const act of (pending as StravaActivity[]) ?? []) {
    const mappedSport = mapStravaSportType(act.sport_type);
    let matchedWorkout: Workout | null = null;

    // Conservative on purpose: only auto-complete when there is EXACTLY
    // one un-linked planned workout for this athlete on the same local
    // day and sport. Zero or multiple candidates are left for manual
    // review rather than guessing — see the "Strava integration" note in
    // CLAUDE.md for why date+sport alone isn't reliable enough to guess.
    if (mappedSport && act.local_date) {
      const { data: candidates } = await db
        .from("workouts")
        .select("*")
        .eq("athlete_id", athlete.id)
        .eq("date", act.local_date)
        .eq("sport", mappedSport)
        .is("strava_activity_id", null);
      if (candidates && candidates.length === 1) {
        matchedWorkout = candidates[0] as Workout;
      }
    }

    if (matchedWorkout) {
      await db
        .from("workouts")
        .update({ done: true, strava_activity_id: act.id })
        .eq("id", matchedWorkout.id);
      matched++;
    }

    // Best-effort: never blocks marking this activity as processed, same
    // as every other optional AI/notification step in this codebase.
    const description = await generateActivityDescription(act, matchedWorkout).catch(() => null);
    if (description) {
      try {
        await updateStravaActivityDescription(accessToken, act.id, description);
        described++;
      } catch (e) {
        console.error("Failed to write description back to Strava", act.id, e);
      }
    }

    await db.from("strava_activities").update({ description_written_at: new Date().toISOString() }).eq("id", act.id);
  }

  return NextResponse.json({
    ok: true,
    synced: rows.length,
    matched,
    described,
  });
}
