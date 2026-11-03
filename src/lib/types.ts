/**
 * A loose alias now, not a two-value union — the roster stopped being a
 * fixed Juan/José pair once /admin's invite flow could add anyone (see
 * CLAUDE.md's "Real auth + admin" section). Kept as its own name (rather
 * than inlining `string` everywhere) purely so call sites that are really
 * about athlete identity stay self-documenting.
 */
export type AthleteSlug = string;
export type Sport = "swim" | "bike" | "run" | "gym" | "race";

export const SPORTS: Sport[] = ["swim", "bike", "run", "gym", "race"];

export interface Athlete {
  id: string;
  slug: AthleteSlug;
  name: string;
  initials: string;
  auth_user_id: string | null;
  email: string | null;
  /** Can reach /admin — only ever set server-side, see CLAUDE.md. */
  is_admin: boolean;
  /** Lactate threshold heart rate, in bpm. */
  threshold_hr: number | null;
  /** Running threshold pace ("race predictor"), in seconds per km. */
  threshold_pace_sec_per_km: number | null;
  /** Cycling functional threshold power, in watts. */
  ftp_watts: number | null;
  /** VO2max, in ml/kg/min — manually entered by the athlete. */
  vo2max: number | null;
  /** Device-measured VO2max (running) from Garmin's user-metrics push — distinct from the manually-entered vo2max above. */
  garmin_vo2max: number | null;
  /** Device-measured VO2max (cycling) from Garmin's user-metrics push. */
  garmin_vo2max_cycling: number | null;
  /** Device-estimated fitness age from Garmin's user-metrics push. */
  garmin_fitness_age: number | null;
  garmin_health_synced_at: string | null;
  /** From WHOOP's GET /v2/user/measurement/body — see lib/integrations/whoop.ts. */
  whoop_height_m: number | null;
  whoop_weight_kg: number | null;
  whoop_max_hr: number | null;
  whoop_profile_synced_at: string | null;
  /** Raw heart_rate.zones from Strava's GET /athlete/zones, if configured there. */
  strava_hr_zones: { min: number; max: number }[] | null;
  /** Raw power.zones from Strava's GET /athlete/zones, if configured there. */
  strava_power_zones: { min: number; max: number }[] | null;
  strava_zones_synced_at: string | null;
  /** Weight in kg, from Strava's GET /athlete. */
  strava_weight_kg: number | null;
  /** Raw GET /athletes/{id}/stats response — recent (4wk) / YTD / all-time totals per sport. */
  strava_stats: StravaAthleteStats | null;
  strava_profile_synced_at: string | null;
  /** Raw shoes + bikes list from Strava's GET /athlete. */
  strava_gear: { id: string; name: string }[] | null;
  birth_date: string | null;
  sex: "male" | "female" | "other" | null;
  height_cm: number | null;
  /** Manually entered body weight (kg) — distinct from strava_weight_kg. */
  weight_kg: number | null;
  resting_hr: number | null;
  max_hr: number | null;
  goal_race_name: string | null;
  goal_race_date: string | null;
  goal_distance: string | null;
  goal_notes: string | null;
  personal_bests: PersonalBest[];
}

export interface PersonalBest {
  id: string;
  sport: Sport;
  distanceLabel: string;
  /** Null for a non-standard distance with no known meters — excluded from the race predictor. */
  distanceMeters: number | null;
  timeSec: number;
  date: string;
  raceName: string;
}

export interface StravaTotals {
  count: number;
  distance: number; // meters
  moving_time: number; // seconds
  elevation_gain: number; // meters
}

export interface StravaAthleteStats {
  recent_run_totals?: StravaTotals;
  recent_ride_totals?: StravaTotals;
  recent_swim_totals?: StravaTotals;
  ytd_run_totals?: StravaTotals;
  ytd_ride_totals?: StravaTotals;
  ytd_swim_totals?: StravaTotals;
  all_run_totals?: StravaTotals;
  all_ride_totals?: StravaTotals;
  all_swim_totals?: StravaTotals;
}

export interface Workout {
  id: string;
  athlete_id: string;
  date: string; // YYYY-MM-DD
  sport: Sport;
  title: string;
  start: string | null; // HH:MM
  minutes: number;
  km: number;
  notes: string;
  done: boolean;
  strava_activity_id: string | null;
  /** Human-written summary used verbatim as the Strava description when matched — takes priority over the AI-generated one. */
  strava_comment: string;
  /** Free-text workout type/structure (e.g. "Tempo", "Series"). */
  workout_type: string;
  /** Rating of Perceived Exertion, Borg CR10 (0-10). */
  rpe: number | null;
  /** Structured steps — see WorkoutStep below. Empty array = no structure yet. */
  workout_steps: WorkoutStep[];
  created_at: string;
  updated_at: string;
}

export type WorkoutStepKind = "warmup" | "work" | "recovery" | "cooldown" | "rest";
export type WorkoutStepDurationType = "time" | "distance" | "open";
export type WorkoutStepTargetType = "pace" | "hr" | "power" | "cadence" | "open";

/**
 * One step of a structured workout (e.g. one interval of "6x400m @ 5K
 * pace, 90s easy recovery"). Deliberately flat with at most ONE level of
 * repeat grouping — COROS's own push API reportedly does not support
 * nested repeat blocks (see CLAUDE.md's COROS research note), so modeling
 * it that way from the start avoids needing to flatten a richer structure
 * later just to fit their API.
 */
export interface WorkoutStep {
  id: string;
  kind: WorkoutStepKind;
  durationType: WorkoutStepDurationType;
  /** Seconds if durationType is "time", meters if "distance", null if "open". */
  durationValue: number | null;
  targetType: WorkoutStepTargetType;
  /** Unit depends on targetType: sec/km for pace, bpm for hr, watts for power, rpm for cadence. Null for "open". */
  targetLow: number | null;
  targetHigh: number | null;
  /** When set, this step repeats this many times (e.g. 6 for "6x400m") — the one level of repeat grouping this model supports. */
  repeatCount: number | null;
}

export interface CorosConnection {
  athlete_id: string;
  coros_athlete_id: string | null;
  connected_at: string;
  last_synced_at: string | null;
  scope: string | null;
}

export interface Template {
  id: string;
  sport: Sport;
  title: string;
  minutes: number;
  km: number;
  notes: string;
  created_at: string;
}

export interface StravaConnection {
  athlete_id: string;
  strava_athlete_id: number;
  connected_at: string;
  last_synced_at: string | null;
  scope: string | null;
}

export interface StravaActivity {
  id: string; // strava activity id, as text
  athlete_id: string;
  name: string;
  sport_type: string;
  start_date: string;
  /** Local calendar date (YYYY-MM-DD), from Strava's start_date_local. */
  local_date: string | null;
  moving_time_s: number;
  distance_m: number;
  average_cadence: number | null;
  average_speed: number | null;
  average_heart_rate: number | null;
  synced_at: string;
  description_written_at: string | null;
  /** Strava's own "Relative Effort" score (raw.suffer_score) — their proprietary intensity metric. */
  relative_effort: number | null;
  total_elevation_gain_m: number | null;
  max_heart_rate: number | null;
  average_watts: number | null;
  calories: number | null;
  /** Shoe or bike name used, resolved from Strava's gear list at sync time. */
  gear_name: string | null;
  /** The full raw activity object Strava's list endpoint returned, stored
   * verbatim at sync time (see app/api/strava/sync/route.ts) — includes
   * fields never extracted into their own column, notably `map.summary_polyline`
   * (an encoded route), decoded and drawn by components/ActivityMap.tsx. */
  raw: { map?: { summary_polyline?: string | null } | null } | null;
}

export type ActivityWithSlug = StravaActivity & { athleteSlug: AthleteSlug };

/**
 * Garmin Health API-derived metrics (Nov 2026) — one interface per
 * pushed object type, parsed from garmin_push_events by
 * lib/integrations/garminHealthParse.ts into the tables migration 029
 * creates. See CLAUDE.md's "Garmin Health metrics" section: field
 * names are confirmed from the real OpenAPI spec, but the push
 * envelope itself (and therefore whether every field below actually
 * arrives) is not yet confirmed against a real payload.
 */
export interface GarminDailyHealth {
  athlete_id: string;
  calendar_date: string;
  steps: number | null;
  active_kilocalories: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  average_stress_level: number | null;
  max_stress_level: number | null;
  resting_heart_rate: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
}

export interface GarminSleep {
  athlete_id: string;
  calendar_date: string;
  duration_s: number | null;
  deep_s: number | null;
  light_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  overall_score: number | null;
}

export interface GarminHrv {
  athlete_id: string;
  calendar_date: string;
  last_night_avg: number | null;
  last_night_5min_high: number | null;
}

/** avg/min are computed by this codebase from raw per-epoch readings — not a Garmin-reported daily summary number. */
export interface GarminPulseOx {
  athlete_id: string;
  calendar_date: string;
  avg_spo2: number | null;
  min_spo2: number | null;
}

/** avg_breaths_per_min is computed by this codebase from raw per-epoch readings — same caveat as GarminPulseOx. */
export interface GarminRespiration {
  athlete_id: string;
  calendar_date: string;
  avg_breaths_per_min: number | null;
}

export interface GarminBodyComp {
  id: string;
  athlete_id: string;
  measured_at: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  body_water_pct: number | null;
  muscle_mass_kg: number | null;
  bone_mass_kg: number | null;
  bmi: number | null;
}

export interface GarminHydration {
  athlete_id: string;
  calendar_date: string;
  fluid_intake_ml: number | null;
}

export interface GarminHealthSnapshotSummary {
  summaryType: string;
  minValue?: number;
  maxValue?: number;
  avgValue?: number;
}

export interface GarminHealthSnapshot {
  athlete_id: string;
  calendar_date: string;
  summaries: GarminHealthSnapshotSummary[] | null;
}

/**
 * WHOOP (Nov 2026) — one interface per stored row, parsed from the real
 * WHOOP API response shapes (see lib/integrations/whoop.ts) by
 * app/api/whoop/sync/route.ts.
 */
export interface WhoopCycle {
  athlete_id: string;
  whoop_cycle_id: number;
  start_at: string;
  end_at: string | null;
  score_state: string;
  strain: number | null;
  kilojoule: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  step_count: number | null;
}

export interface WhoopSleep {
  athlete_id: string;
  whoop_sleep_id: string;
  whoop_cycle_id: number | null;
  start_at: string;
  end_at: string;
  nap: boolean;
  score_state: string;
  respiratory_rate: number | null;
  sleep_performance_pct: number | null;
  sleep_consistency_pct: number | null;
  sleep_efficiency_pct: number | null;
  total_in_bed_ms: number | null;
  total_awake_ms: number | null;
  total_light_ms: number | null;
  total_sws_ms: number | null;
  total_rem_ms: number | null;
  sleep_cycle_count: number | null;
  disturbance_count: number | null;
}

export interface WhoopRecovery {
  athlete_id: string;
  whoop_cycle_id: number;
  whoop_sleep_id: string | null;
  score_state: string;
  recovery_score: number | null;
  resting_heart_rate: number | null;
  hrv_rmssd_milli: number | null;
  spo2_percentage: number | null;
  skin_temp_celsius: number | null;
}

export interface WhoopWorkout {
  athlete_id: string;
  whoop_workout_id: string;
  sport_name: string | null;
  start_at: string;
  end_at: string;
  score_state: string;
  strain: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  kilojoule: number | null;
  distance_meter: number | null;
  altitude_gain_meter: number | null;
}
