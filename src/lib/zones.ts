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
