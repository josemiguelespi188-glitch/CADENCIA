import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchWhoopBodyMeasurement,
  fetchWhoopCycles,
  fetchWhoopRecovery,
  fetchWhoopSleep,
  fetchWhoopWorkouts,
  getValidWhoopAccessToken,
} from "@/lib/integrations/whoop";

/** Same 30-day window Strava's sync settled on ("no necesito lo
 * histórico, solamente el último mes") — WHOOP's API supports pulling
 * further back via `start`, but there's no reason to default wider
 * than every other sync in this app already does. */
const SYNC_DAYS = 30;

/**
 * Pulls the signed-in athlete's recent WHOOP data and upserts it into
 * whoop_cycles/whoop_sleep/whoop_recovery/whoop_workouts, plus their
 * body measurement onto `athletes`. Manual "Sync now" button, same
 * model as Strava — WHOOP's public API has no push/webhook capability
 * at all (see lib/integrations/whoop.ts's file header).
 */
export async function POST() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const accessToken = await getValidWhoopAccessToken(athlete.id);
  if (!accessToken) return NextResponse.json({ error: "No WHOOP connection for this athlete." }, { status: 400 });

  const db = createServiceClient();
  const start = new Date(Date.now() - SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const bodyMeasurement = await fetchWhoopBodyMeasurement(accessToken);
    if (bodyMeasurement) {
      await db
        .from("athletes")
        .update({
          whoop_height_m: bodyMeasurement.height_meter,
          whoop_weight_kg: bodyMeasurement.weight_kilogram,
          whoop_max_hr: bodyMeasurement.max_heart_rate,
          whoop_profile_synced_at: new Date().toISOString(),
        })
        .eq("id", athlete.id);
    }
  } catch (e) {
    console.error("WHOOP body measurement sync failed (non-blocking)", e);
  }

  const [cycles, sleeps, recoveries, workouts] = await Promise.all([
    fetchWhoopCycles(accessToken, start),
    fetchWhoopSleep(accessToken, start),
    fetchWhoopRecovery(accessToken, start),
    fetchWhoopWorkouts(accessToken, start),
  ]);

  if (cycles.length) {
    await db.from("whoop_cycles").upsert(
      cycles.map((c) => ({
        athlete_id: athlete.id,
        whoop_cycle_id: c.id,
        start_at: c.start,
        end_at: c.end ?? null,
        score_state: c.score_state,
        strain: c.score?.strain ?? null,
        kilojoule: c.score?.kilojoule ?? null,
        average_heart_rate: c.score?.average_heart_rate ?? null,
        max_heart_rate: c.score?.max_heart_rate ?? null,
        step_count: c.step_count ?? null,
        raw: c,
      })),
      { onConflict: "athlete_id,whoop_cycle_id" }
    );
  }

  if (sleeps.length) {
    await db.from("whoop_sleep").upsert(
      sleeps.map((s) => ({
        athlete_id: athlete.id,
        whoop_sleep_id: s.id,
        whoop_cycle_id: s.cycle_id,
        start_at: s.start,
        end_at: s.end,
        nap: s.nap,
        score_state: s.score_state,
        respiratory_rate: s.score?.respiratory_rate ?? null,
        sleep_performance_pct: s.score?.sleep_performance_percentage ?? null,
        sleep_consistency_pct: s.score?.sleep_consistency_percentage ?? null,
        sleep_efficiency_pct: s.score?.sleep_efficiency_percentage ?? null,
        total_in_bed_ms: s.score?.stage_summary.total_in_bed_time_milli ?? null,
        total_awake_ms: s.score?.stage_summary.total_awake_time_milli ?? null,
        total_light_ms: s.score?.stage_summary.total_light_sleep_time_milli ?? null,
        total_sws_ms: s.score?.stage_summary.total_slow_wave_sleep_time_milli ?? null,
        total_rem_ms: s.score?.stage_summary.total_rem_sleep_time_milli ?? null,
        sleep_cycle_count: s.score?.stage_summary.sleep_cycle_count ?? null,
        disturbance_count: s.score?.stage_summary.disturbance_count ?? null,
        raw: s,
      })),
      { onConflict: "athlete_id,whoop_sleep_id" }
    );
  }

  if (recoveries.length) {
    await db.from("whoop_recovery").upsert(
      recoveries.map((r) => ({
        athlete_id: athlete.id,
        whoop_cycle_id: r.cycle_id,
        whoop_sleep_id: r.sleep_id ?? null,
        score_state: r.score_state,
        recovery_score: r.score?.recovery_score ?? null,
        resting_heart_rate: r.score?.resting_heart_rate ?? null,
        hrv_rmssd_milli: r.score?.hrv_rmssd_milli ?? null,
        spo2_percentage: r.score?.spo2_percentage ?? null,
        skin_temp_celsius: r.score?.skin_temp_celsius ?? null,
        raw: r,
      })),
      { onConflict: "athlete_id,whoop_cycle_id" }
    );
  }

  if (workouts.length) {
    await db.from("whoop_workouts").upsert(
      workouts.map((w) => ({
        athlete_id: athlete.id,
        whoop_workout_id: w.id,
        sport_name: w.sport_name,
        start_at: w.start,
        end_at: w.end,
        score_state: w.score_state,
        strain: w.score?.strain ?? null,
        average_heart_rate: w.score?.average_heart_rate ?? null,
        max_heart_rate: w.score?.max_heart_rate ?? null,
        kilojoule: w.score?.kilojoule ?? null,
        distance_meter: w.score?.distance_meter ?? null,
        altitude_gain_meter: w.score?.altitude_gain_meter ?? null,
        zone_durations: w.score?.zone_durations ?? null,
        raw: w,
      })),
      { onConflict: "athlete_id,whoop_workout_id" }
    );
  }

  await db.from("whoop_connections").update({ last_synced_at: new Date().toISOString() }).eq("athlete_id", athlete.id);

  return NextResponse.json({
    cycles: cycles.length,
    sleeps: sleeps.length,
    recoveries: recoveries.length,
    workouts: workouts.length,
  });
}
