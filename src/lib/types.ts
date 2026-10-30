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
  synced_at: string;
  description_written_at: string | null;
}
