import type { ActivityWithSlug, Athlete } from "@/lib/types";
import { predictRaceTimes } from "@/lib/racePredictor";

export interface CompareAxis {
  key: string;
  label: string;
  unit: string;
  a: number;
  b: number;
}

/** 5K pace -> km/h, so "higher is better" the same direction as every
 * other radar axis (VO2max, FTP, weekly volume) — pace alone is "lower is
 * better," which would need its own inverted normalization rule on the
 * chart. Returns null if neither athlete has a run personal best to
 * project from (predictRaceTimes already returns null in that case). */
function fiveKSpeedKmh(athlete: Athlete): number | null {
  const predicted = predictRaceTimes(athlete.personal_bests);
  const five = predicted?.find((p) => p.key === "5k");
  if (!five || five.predictedSec <= 0) return null;
  return (5 / (five.predictedSec / 3600)); // km/h
}

function weeklyVolumeHrs(activities: ActivityWithSlug[], athleteId: string): number {
  const totalSec = activities.filter((a) => a.athlete_id === athleteId).reduce((acc, a) => acc + (a.moving_time_s ?? 0), 0);
  // Activities are already scoped to "last 30 days" everywhere this app
  // reads strava_activities (see CLAUDE.md) — divide by ~4.3 weeks for a
  // weekly-average figure, not a true single-week snapshot.
  return totalSec / 3600 / 4.3;
}

/**
 * Builds the radar chart's axes for two athletes — Community Phase 2
 * compare view (see CLAUDE.md's "Community" section). Deliberately only
 * includes an axis when BOTH athletes have a real value for it (apples to
 * apples) — a missing metric is left out of the radar entirely rather
 * than zeroed, which would unfairly make an athlete who simply hasn't
 * filled in e.g. FTP look like they have none. Every value here is either
 * device/self-reported (VO2max, FTP, resting HR) or derived from a
 * published formula already used elsewhere in this app (Riegel's 5K
 * projection, see lib/racePredictor.ts) — nothing fabricated.
 */
export function buildCompareAxes(a: Athlete, b: Athlete, activitiesA: ActivityWithSlug[], activitiesB: ActivityWithSlug[]): CompareAxis[] {
  const axes: CompareAxis[] = [];

  const volA = weeklyVolumeHrs(activitiesA, a.id);
  const volB = weeklyVolumeHrs(activitiesB, b.id);
  if (volA > 0 || volB > 0) axes.push({ key: "volume", label: "Weekly volume", unit: "h/wk", a: volA, b: volB });

  const vo2A = a.garmin_vo2max ?? a.vo2max;
  const vo2B = b.garmin_vo2max ?? b.vo2max;
  if (vo2A && vo2B) axes.push({ key: "vo2max", label: "VO2max", unit: "ml/kg/min", a: vo2A, b: vo2B });

  if (a.ftp_watts && b.ftp_watts) axes.push({ key: "ftp", label: "FTP", unit: "W", a: a.ftp_watts, b: b.ftp_watts });

  const speedA = fiveKSpeedKmh(a);
  const speedB = fiveKSpeedKmh(b);
  if (speedA && speedB) axes.push({ key: "5k", label: "5K speed", unit: "km/h", a: Math.round(speedA * 10) / 10, b: Math.round(speedB * 10) / 10 });

  // Lower resting HR is the fitter reading — inverted here (a fixed 100bpm
  // reference minus the real value) so this axis still reads "outward =
  // better," same direction as every other axis on the chart.
  if (a.resting_hr && b.resting_hr) {
    axes.push({ key: "resting_hr", label: "Resting HR (inverted)", unit: "bpm", a: Math.max(0, 100 - a.resting_hr), b: Math.max(0, 100 - b.resting_hr) });
  }

  return axes;
}
