export type AthleteSlug = "juan" | "jose";
export type Who = AthleteSlug | "both";
export type Sport = "swim" | "bike" | "run" | "gym" | "race";

export const SPORTS: Sport[] = ["swim", "bike", "run", "gym", "race"];

export const ATHLETES: Record<AthleteSlug, { name: string; initials: string }> = {
  juan: { name: "Juan", initials: "JB" },
  jose: { name: "José Miguel", initials: "JE" },
};

export interface Athlete {
  id: string;
  slug: AthleteSlug;
  name: string;
  initials: string;
  auth_user_id: string | null;
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
}
