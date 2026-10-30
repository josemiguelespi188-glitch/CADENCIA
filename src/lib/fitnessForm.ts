import { addDays, dayDiff, parseYmd, today, ymd } from "@/lib/dates";

export interface DailyLoad {
  date: string; // YYYY-MM-DD
  stress: number;
}

export interface FitnessFormPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface FitnessFormResult {
  current: FitnessFormPoint;
  series: FitnessFormPoint[];
  /** How many days of real (possibly zero-filled) history fed the model. */
  daysOfHistory: number;
  /** True once there's at least a full 42-day CTL window — before that the
   * EWMA is still ramping up from zero and understates true fitness. */
  warmedUp: boolean;
}

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/**
 * Fitness (CTL) / Fatigue (ATL) / Form (TSB) — the Banister impulse-
 * response model TrainingPeaks itself popularized: CTL is a 42-day
 * exponentially-weighted moving average of daily training stress, ATL a
 * 7-day EWMA of the same, and TSB (Form) = yesterday's CTL - yesterday's
 * ATL (how fresh today, given yesterday's accumulated load). A real,
 * published formula, not reverse-engineered from any proprietary source —
 * see CLAUDE.md's "Fitness/Fatigue/Form" note for why this was deferred
 * until there was more than 30 days of history to feed it, and why 42 days
 * still isn't "fully converged" (a cold start understates true fitness for
 * a while — `warmedUp` flags that honestly instead of hiding it).
 *
 * `loads` need not be dense or sorted — gaps (rest days) are filled with
 * zero stress for every day between the earliest and latest date given.
 */
export function computeFitnessForm(loads: DailyLoad[]): FitnessFormResult | null {
  if (!loads.length) return null;
  const byDate = new Map(loads.map((l) => [l.date, l.stress]));
  const dates = loads.map((l) => parseYmd(l.date));
  const start = dates.reduce((a, b) => (b < a ? b : a));
  const end = today();
  const totalDays = dayDiff(start, end) + 1;

  const alphaCtl = 2 / (CTL_DAYS + 1);
  const alphaAtl = 2 / (ATL_DAYS + 1);
  let ctl = 0;
  let atl = 0;
  const series: FitnessFormPoint[] = [];

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(start, i);
    const key = ymd(d);
    const stress = byDate.get(key) ?? 0;
    const tsb = ctl - atl; // form going into today, from yesterday's accumulated load
    ctl = ctl + alphaCtl * (stress - ctl);
    atl = atl + alphaAtl * (stress - atl);
    series.push({ date: key, ctl, atl, tsb });
  }

  const current = series[series.length - 1];
  return { current, series, daysOfHistory: totalDays, warmedUp: totalDays >= CTL_DAYS };
}
