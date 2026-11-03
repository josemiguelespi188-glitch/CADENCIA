import type { PersonalBest, Sport } from "@/lib/types";

/** Common preset distances offered in the personal-bests editor, per sport
 * — picking one fills in a known `distanceMeters` so the run ones can feed
 * the race predictor below; "Custom" lets the athlete type their own
 * label with no meters value (so it's just a record, not used to predict). */
export const DISTANCE_PRESETS: Record<Sport, { label: string; meters: number | null }[]> = {
  run: [
    { label: "1 Mile", meters: 1609 },
    { label: "5K", meters: 5000 },
    { label: "10K", meters: 10000 },
    { label: "15K", meters: 15000 },
    { label: "Half Marathon", meters: 21097 },
    { label: "Marathon", meters: 42195 },
    { label: "Custom", meters: null },
  ],
  bike: [
    { label: "20K", meters: 20000 },
    { label: "40K (TT)", meters: 40000 },
    { label: "90K (70.3 bike leg)", meters: 90000 },
    { label: "180K (Ironman bike leg)", meters: 180000 },
    { label: "Custom", meters: null },
  ],
  swim: [
    { label: "100m", meters: 100 },
    { label: "200m", meters: 200 },
    { label: "400m", meters: 400 },
    { label: "750m", meters: 750 },
    { label: "1500m", meters: 1500 },
    { label: "1.9K (70.3 swim leg)", meters: 1900 },
    { label: "3.8K (Ironman swim leg)", meters: 3800 },
    { label: "Custom", meters: null },
  ],
  gym: [{ label: "Custom", meters: null }],
  brick: [{ label: "Custom", meters: null }],
  race: [
    { label: "Sprint Triathlon", meters: null },
    { label: "Olympic Triathlon", meters: null },
    { label: "70.3 (Half Ironman)", meters: null },
    { label: "Ironman (140.6)", meters: null },
    { label: "Custom", meters: null },
  ],
};

/** Standard running race distances a predictor can target. */
export const STANDARD_RUN_DISTANCES = [
  { key: "5k", label: "5K", meters: 5000 },
  { key: "10k", label: "10K", meters: 10000 },
  { key: "half", label: "Half Marathon", meters: 21097 },
  { key: "marathon", label: "Marathon", meters: 42195 },
] as const;

export interface PredictedTime {
  key: string;
  label: string;
  meters: number;
  predictedSec: number;
  /** True when this came straight from a real personal best (within 2%), not a projection. */
  fromActual: boolean;
}

/**
 * Projects race times at the standard distances using Riegel's formula
 * (T2 = T1 * (D2/D1)^1.06) from the single longest known run personal
 * best — a real, published endurance-prediction formula (Peter Riegel,
 * 1977/1981), not a reverse-engineered or invented one.
 *
 * This is a deliberately simple, single-reference model: a true VDOT-
 * style calculator would weight multiple recent results and account for
 * training load, which this app doesn't track. Always labeled "estimated"
 * in the UI for exactly this reason — see CLAUDE.md's "Comprehensive
 * athlete profile" note. Returns null if there's no run PB with a known
 * distance to project from.
 */
export function predictRaceTimes(personalBests: PersonalBest[]): PredictedTime[] | null {
  const runPbs = personalBests.filter((p) => p.sport === "run" && p.distanceMeters && p.timeSec > 0);
  if (!runPbs.length) return null;
  const reference = runPbs.reduce((a, b) => ((b.distanceMeters ?? 0) > (a.distanceMeters ?? 0) ? b : a));
  const refMeters = reference.distanceMeters!;
  const refSec = reference.timeSec;

  return STANDARD_RUN_DISTANCES.map((d) => {
    const exact = runPbs.find((p) => Math.abs((p.distanceMeters ?? 0) - d.meters) / d.meters <= 0.02);
    if (exact) {
      return { key: d.key, label: d.label, meters: d.meters, predictedSec: exact.timeSec, fromActual: true };
    }
    const predictedSec = refSec * Math.pow(d.meters / refMeters, 1.06);
    return { key: d.key, label: d.label, meters: d.meters, predictedSec, fromActual: false };
  });
}
