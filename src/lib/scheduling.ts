/**
 * Default workout start-time assignment (Nov 2026) — direct instruction:
 * "todos los entrenos tiene que tener una hora para poner en el
 * calendario. si no tiene poner 6 am. y si tiene dos intuir que son dos
 * sesiones, 6am y 6pm. Si es brick obvio va bici y seguido el trote.
 * Corregir este tema de horarios automaticos. lo ideal es que se ponga
 * una vez se crea el entrenamiento." See CLAUDE.md's "Download week now
 * also sends to a watch, every exported workout gets a real time"
 * section for the full picture — this file is just the pure scheduling
 * rule, used both at workout-creation time (`calendar/page.tsx`'s
 * `saveWorkout`) and as an export-time fallback for any workout that
 * still has no `start` (legacy rows, Excel import, Community
 * bulk-assign — none of those currently collect/assign a time either).
 *
 * A brick workout (bike immediately followed by a run) is deliberately
 * NOT split into two slots here — it's one `workouts` row representing
 * one combined session, exactly like any other sport, so it only ever
 * claims one daily slot like everything else. The "bike then run" part
 * is just what happens inside that one block once the athlete's really
 * training it, not something this scheduler needs to model as two
 * separate timed events.
 */

export const MORNING_SLOT = "06:00";
export const EVENING_SLOT = "18:00";

export interface SchedulableWorkout {
  id: string;
  date: string;
  athleteSlug: string;
  start: string | null;
}

/**
 * Picks a default start time for ONE new workout being created, given
 * every other workout this same athlete already has saved that day
 * (`siblings`) — their own `start` is already fixed/persisted, so
 * there's no ordering ambiguity the way a batch of several still-unsaved
 * rows has (see `assignDefaultStartTimes` below for that case). Whichever
 * of the two daily slots isn't already taken by a sibling is what gets
 * assigned: the first session of the day defaults to the morning slot,
 * a second one to the evening slot. A third+ same-day session has no
 * clean slot of its own left to claim — falls back to the morning slot
 * rather than being left unscheduled.
 */
export function defaultStartTimeForNew(siblings: { start: string | null }[]): string {
  const morningTaken = siblings.some((s) => s.start === MORNING_SLOT);
  if (!morningTaken) return MORNING_SLOT;
  const eveningTaken = siblings.some((s) => s.start === EVENING_SLOT);
  if (!eveningTaken) return EVENING_SLOT;
  return MORNING_SLOT;
}

/**
 * Batch version, for exporting/scheduling a whole week at once, where
 * MULTIPLE same-day workouts might still have no `start` at all (rows
 * created before this feature existed, or bulk-inserted without a time
 * column — Excel import, Community's "Assign workout to everyone").
 * Returns the effective start time to use for every workout passed in
 * (never null): an already-set `start` is returned unchanged; a still-
 * unset one is assigned deterministically in the array's own order,
 * claiming the free morning slot first, then the free evening slot,
 * falling back to the morning slot again for any 3rd+ same-day session.
 * Needed specifically because the single-workout rule above can't just
 * be applied independently to each row in a batch — if two still-unset
 * same-day rows both looked only at each other's (also still-null)
 * `start`, they'd both land on the morning slot instead of splitting
 * into morning/evening.
 */
export function assignDefaultStartTimes<T extends SchedulableWorkout>(workouts: T[]): Map<string, string> {
  const result = new Map<string, string>();
  const takenByDay = new Map<string, Set<string>>();

  for (const w of workouts) {
    if (!w.start) continue;
    const key = `${w.athleteSlug}|${w.date}`;
    const set = takenByDay.get(key) ?? new Set<string>();
    set.add(w.start);
    takenByDay.set(key, set);
  }

  for (const w of workouts) {
    if (w.start) {
      result.set(w.id, w.start);
      continue;
    }
    const key = `${w.athleteSlug}|${w.date}`;
    const taken = takenByDay.get(key) ?? new Set<string>();
    const slot = !taken.has(MORNING_SLOT) ? MORNING_SLOT : !taken.has(EVENING_SLOT) ? EVENING_SLOT : MORNING_SLOT;
    taken.add(slot);
    takenByDay.set(key, taken);
    result.set(w.id, slot);
  }

  return result;
}
