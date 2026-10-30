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
  /** VO2max, in ml/kg/min. */
  vo2max: number | null;
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
  created_at: string;
  updated_at: string;
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
