/**
 * Pure helpers with no server-only dependencies (unlike lib/integrations/
 * strava.ts, which imports the service-role Supabase client and can't be
 * imported from a "use client" component). Keep this file free of any
 * server-only import.
 */

/** Maps a sport-shaped Cadencia value from Strava's own `sport_type` string. */
export function mapStravaSportType(sportType: string): "swim" | "bike" | "run" | "gym" | null {
  const s = sportType.toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "bike";
  if (s.includes("run")) return "run";
  if (s.includes("weight") || s.includes("workout") || s.includes("training")) return "gym";
  return null;
}
