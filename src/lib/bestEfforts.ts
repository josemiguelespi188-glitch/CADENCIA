import type { StravaActivity } from "@/lib/types";
import { mapStravaSportType } from "@/lib/sport";

export const DISTANCE_BUCKETS = [
  { key: "5k", label: "5K", meters: 5000, tolerance: 0.05 },
  { key: "10k", label: "10K", meters: 10000, tolerance: 0.05 },
  { key: "half", label: "21K", meters: 21097, tolerance: 0.03 },
  { key: "marathon", label: "42K", meters: 42195, tolerance: 0.03 },
] as const;

export interface BestEffort {
  key: string;
  label: string;
  best: StravaActivity | null;
}

/**
 * Best (fastest-pace) run matching each standard distance within a
 * tolerance, from whatever activities are passed in — this dashboard only
 * ever has the last 30 days loaded (see CLAUDE.md), so this is
 * deliberately labeled "best effort (last 30 days)" in the UI, never
 * "personal record" — it has no visibility into anything older.
 */
export function computeBestEfforts(activities: StravaActivity[]): BestEffort[] {
  const runs = activities.filter((a) => mapStravaSportType(a.sport_type) === "run" && a.distance_m > 0 && a.moving_time_s > 0);
  return DISTANCE_BUCKETS.map((bucket) => {
    const candidates = runs.filter((a) => Math.abs(a.distance_m - bucket.meters) / bucket.meters <= bucket.tolerance);
    if (!candidates.length) return { key: bucket.key, label: bucket.label, best: null };
    const best = candidates.reduce((a, b) => (a.moving_time_s / a.distance_m < b.moving_time_s / b.distance_m ? a : b));
    return { key: bucket.key, label: bucket.label, best };
  });
}
