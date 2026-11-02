/**
 * Threshold-based training zones, computed from an athlete's own LTHR /
 * threshold pace / FTP. Uses the standard, published %-of-threshold model
 * (Allen & Coggan, "Training and Racing with a Power Meter") — NOT a
 * reverse-engineered copy of any specific platform's proprietary zone
 * algorithm (there isn't enough public spec to do that honestly). See
 * CLAUDE.md's "Training-zone thresholds" section for the full rationale.
 */

export type ZoneKey = "recovery" | "endurance" | "tempo" | "threshold" | "vo2max" | "anaerobic" | "neuromuscular";

export interface ZoneBand {
  key: ZoneKey;
  pctMin: number;
  pctMax: number | null; // null = unbounded above
}

/** 6-zone %LTHR model, reused as-is (inverted) for running pace zones. */
export const HR_ZONE_BANDS: ZoneBand[] = [
  { key: "recovery", pctMin: 0, pctMax: 0.81 },
  { key: "endurance", pctMin: 0.81, pctMax: 0.89 },
  { key: "tempo", pctMin: 0.9, pctMax: 0.93 },
  { key: "threshold", pctMin: 0.94, pctMax: 0.99 },
  { key: "vo2max", pctMin: 1.0, pctMax: 1.02 },
  { key: "anaerobic", pctMin: 1.03, pctMax: null },
];

/** Coggan's classic 7-zone %FTP power model. */
export const POWER_ZONE_BANDS: ZoneBand[] = [
  { key: "recovery", pctMin: 0, pctMax: 0.55 },
  { key: "endurance", pctMin: 0.56, pctMax: 0.75 },
  { key: "tempo", pctMin: 0.76, pctMax: 0.9 },
  { key: "threshold", pctMin: 0.91, pctMax: 1.05 },
  { key: "vo2max", pctMin: 1.06, pctMax: 1.2 },
  { key: "anaerobic", pctMin: 1.21, pctMax: 1.5 },
  { key: "neuromuscular", pctMin: 1.51, pctMax: null },
];

export interface HrZone {
  key: ZoneKey;
  min: number;
  max: number | null;
}

export function computeHrZones(thresholdHr: number): HrZone[] {
  return HR_ZONE_BANDS.map((b) => ({
    key: b.key,
    min: Math.round(b.pctMin * thresholdHr),
    max: b.pctMax === null ? null : Math.round(b.pctMax * thresholdHr),
  }));
}

export interface PowerZone {
  key: ZoneKey;
  min: number;
  max: number | null;
}

export function computePowerZones(ftpWatts: number): PowerZone[] {
  return POWER_ZONE_BANDS.map((b) => ({
    key: b.key,
    min: Math.round(b.pctMin * ftpWatts),
    max: b.pctMax === null ? null : Math.round(b.pctMax * ftpWatts),
  }));
}

export interface PaceZone {
  key: ZoneKey;
  /** Faster bound, in seconds/km (lower = faster). Null = no cap (fastest zone). */
  fastSecPerKm: number | null;
  /** Slower bound, in seconds/km. Null = no cap (slowest zone). */
  slowSecPerKm: number | null;
}

/** Inverts the %LTHR bands for pace: a higher %-of-threshold-effort means a FASTER (lower sec/km) pace. */
export function computePaceZones(thresholdPaceSecPerKm: number): PaceZone[] {
  return HR_ZONE_BANDS.map((b) => ({
    key: b.key,
    fastSecPerKm: b.pctMax === null ? null : Math.round(thresholdPaceSecPerKm / b.pctMax),
    slowSecPerKm: b.pctMin === 0 ? null : Math.round(thresholdPaceSecPerKm / b.pctMin),
  }));
}

/** Index -> ZoneKey for a raw Strava zones array (which has no key of its
 * own, just an ordered min/max list) — shared between ZoneTables.tsx (the
 * read-only display) and WorkoutDialog.tsx's per-step zone quick-pick, so
 * both resolve "this athlete's real zones" identically. */
export const ZONE_ORDER: ZoneKey[] = ["recovery", "endurance", "tempo", "threshold", "vo2max", "anaerobic", "neuromuscular"];

/** "Strava zones if the athlete has them configured there, else computed
 * from the manually-entered threshold" — the same resolution ZoneTables
 * already did inline, now shared so the structured-step editor's zone
 * quick-pick (see WorkoutDialog.tsx) uses the exact same real numbers,
 * not a second guess at them. */
export function resolveHrZones(athlete: {
  strava_hr_zones?: { min: number; max: number }[] | null;
  threshold_hr?: number | null;
}): { zones: HrZone[] | null; fromStrava: boolean } {
  const fromStrava = !!(athlete.strava_hr_zones && athlete.strava_hr_zones.length > 0);
  const zones = fromStrava
    ? athlete.strava_hr_zones!.map((z, i) => ({ key: ZONE_ORDER[i] ?? "anaerobic", min: z.min, max: z.max === -1 ? null : z.max }))
    : athlete.threshold_hr
      ? computeHrZones(athlete.threshold_hr)
      : null;
  return { zones, fromStrava };
}

export function resolvePowerZones(athlete: {
  strava_power_zones?: { min: number; max: number }[] | null;
  ftp_watts?: number | null;
}): { zones: PowerZone[] | null; fromStrava: boolean } {
  const fromStrava = !!(athlete.strava_power_zones && athlete.strava_power_zones.length > 0);
  const zones = fromStrava
    ? athlete.strava_power_zones!.map((z, i) => ({ key: ZONE_ORDER[i] ?? "neuromuscular", min: z.min, max: z.max === -1 ? null : z.max }))
    : athlete.ftp_watts
      ? computePowerZones(athlete.ftp_watts)
      : null;
  return { zones, fromStrava };
}

/** Strava has no pace-zones endpoint — always computed from the
 * manually-entered threshold pace, same as ZoneTables already did. */
export function resolvePaceZones(athlete: { threshold_pace_sec_per_km?: number | null }): PaceZone[] | null {
  return athlete.threshold_pace_sec_per_km ? computePaceZones(athlete.threshold_pace_sec_per_km) : null;
}
