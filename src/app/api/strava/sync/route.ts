import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchRecentStravaActivities,
  fetchStravaAthleteProfile,
  fetchStravaAthleteStats,
  fetchStravaAthleteZones,
  getValidAccessToken,
  updateStravaActivityDescription,
} from "@/lib/integrations/strava";
import { mapStravaSportType } from "@/lib/sport";
import { generateActivityDescription } from "@/lib/integrations/claude";
import type { StravaActivity, Workout } from "@/lib/types";

/** How far back the lightweight daily-load history fetch reaches — see the
 * call below. 90 days gives the 42-day CTL EWMA room to meaningfully
 * converge (still not "fully" — see lib/fitnessForm.ts's `warmedUp` flag)
 * without pulling years of history nobody asked for. */
const FITNESS_HISTORY_DAYS = 90;

/**
 * Pulls the named athlete's recent Strava activities, upserts them into
 * `strava_activities`, then runs auto-complete + the AI description
 * write-back for any activity not yet processed (`description_written_at
 * is null`) — see CLAUDE.md's "Strava integration" / roadmap sections for
 * the full rationale behind both pieces below.
 */
export async function POST() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const accessToken = await getValidAccessToken(athlete.id);
  if (!accessToken) {
    return NextResponse.json({ error: "No Strava connection for this athlete." }, { status: 400 });
  }

  const db = createServiceClient();

  // Profile is fetched FIRST (not alongside zones/stats below) because its
  // shoes+bikes list has to exist before building the activity rows, to
  // resolve each activity's gear_id to a real name at insert time rather
  // than in a second pass.
  let gearMap = new Map<string, string>();
  try {
    const profile = await fetchStravaAthleteProfile(accessToken);
    if (profile) {
      gearMap = new Map([...(profile.shoes ?? []), ...(profile.bikes ?? [])].map((g) => [g.id, g.name]));
      const stats = await fetchStravaAthleteStats(accessToken, profile.id);
      await db
        .from("athletes")
        .update({
          strava_weight_kg: profile.weight ?? null,
          strava_stats: stats,
          strava_gear: [...(profile.shoes ?? []), ...(profile.bikes ?? [])],
          strava_profile_synced_at: new Date().toISOString(),
        })
        .eq("id", athlete.id);
    }
  } catch (e) {
    console.error("Failed to fetch Strava athlete profile/stats", e);
  }

  const activities = await fetchRecentStravaActivities(accessToken, 30);

  // Lightweight, summary-only history further back than the 30-day window
  // above — purely to feed the CTL/ATL/TSB (Fitness/Fatigue/Form) model,
  // which needs meaningfully more than 30 days to converge (see CLAUDE.md's
  // "Fitness/Fatigue/Form" note). No per-activity detail is stored from
  // this call, just each day's summed Relative Effort.
  try {
    const history = await fetchRecentStravaActivities(accessToken, FITNESS_HISTORY_DAYS, 15);
    const byDate = new Map<string, number>();
    for (const a of history) {
      if (typeof a.suffer_score !== "number") continue;
      const d = a.start_date_local.slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + a.suffer_score);
    }
    const loadRows = Array.from(byDate.entries()).map(([date, relative_effort]) => ({
      athlete_id: athlete.id,
      date,
      relative_effort,
      updated_at: new Date().toISOString(),
    }));
    if (loadRows.length) {
      const { error } = await db.from("strava_daily_load").upsert(loadRows, { onConflict: "athlete_id,date" });
      // Found live (Nov 2026, full codebase audit): this was never
      // checked — the surrounding try/catch can't catch it, since
      // Supabase returns {error} rather than throwing, so a failed
      // write used to leave FitnessPanel's CTL/ATL/TSB silently stale.
      if (error) console.error("Failed to upsert strava_daily_load", error);
    }
  } catch (e) {
    console.error("Failed to sync Strava daily training load history", e);
  }

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
    relative_effort: a.suffer_score ?? null,
    total_elevation_gain_m: a.total_elevation_gain ?? null,
    max_heart_rate: a.max_heartrate ?? null,
    average_watts: a.average_watts ?? null,
    calories: a.kilojoules ? Math.round(a.kilojoules / 4.184) : null,
    gear_name: a.gear_id ? (gearMap.get(a.gear_id) ?? null) : null,
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

  /** Found live (Nov 2026, full codebase audit): this ran fully
   * sequentially (DB query + possible DB update + a Claude call + a
   * Strava PUT, per activity), risking a serverless timeout on a large
   * backlog (up to 200 pending activities). Processed in small
   * concurrent batches instead — bounded, not fully parallel, so this
   * still doesn't hammer the Claude/Strava APIs with 200 simultaneous
   * requests. */
  const CONCURRENCY = 5;

  // athleteId/token passed explicitly (not read off the outer `athlete`/
  // `accessToken` closure) because TS doesn't propagate null-narrowing
  // into a nested `function` declaration's body.
  async function processActivity(act: StravaActivity, athleteId: string, token: string): Promise<{ matched: boolean; described: boolean }> {
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
        .eq("athlete_id", athleteId)
        .eq("date", act.local_date)
        .eq("sport", mappedSport)
        .is("strava_activity_id", null);
      if (candidates && candidates.length === 1) {
        matchedWorkout = candidates[0] as Workout;
      }
    }

    let didMatch = false;
    if (matchedWorkout) {
      await db
        .from("workouts")
        .update({ done: true, strava_activity_id: act.id })
        .eq("id", matchedWorkout.id);
      didMatch = true;
    }

    // A human-written strava_comment on the matched workout wins verbatim
    // over the AI-generated description — per explicit instruction, it's
    // the planned summary meant to go to Strava, not just an "objective"
    // for the AI to paraphrase. Best-effort either way: never blocks
    // marking this activity as processed.
    const description = matchedWorkout?.strava_comment
      ? matchedWorkout.strava_comment
      : await generateActivityDescription(act, matchedWorkout).catch(() => null);
    let didDescribe = false;
    if (description) {
      try {
        await updateStravaActivityDescription(token, act.id, description);
        didDescribe = true;
      } catch (e) {
        console.error("Failed to write description back to Strava", act.id, e);
      }
    }

    await db.from("strava_activities").update({ description_written_at: new Date().toISOString() }).eq("id", act.id);
    return { matched: didMatch, described: didDescribe };
  }

  const pendingActivities = (pending as StravaActivity[]) ?? [];
  for (let i = 0; i < pendingActivities.length; i += CONCURRENCY) {
    const batch = pendingActivities.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((act) => processActivity(act, athlete.id, accessToken)));
    for (const r of results) {
      if (r.matched) matched++;
      if (r.described) described++;
    }
  }

  return NextResponse.json({
    ok: true,
    synced: rows.length,
    matched,
    described,
  });
}
