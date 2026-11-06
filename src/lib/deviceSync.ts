import type { WorkoutWithSlug } from "@/components/WorkoutDialog";

/**
 * "Send week to watch" (Nov 2026, direct instruction: "el boton de
 * download week tiene que hacer dos cosas. UNO MANDAR LA semana al reloj
 * o cuenta de garmin o coros. 2 descargar al calendario de apple los
 * entrenos.") — see CLAUDE.md's "Download week now also sends to a
 * watch" section. One POST per workout to the existing single-workout
 * `/api/garmin-dev/push` and `/api/coros/push` routes, sequential (a
 * week is at most ~7-14 rows, no need for `/api/strava/sync`'s own
 * concurrency batching built for up to 200).
 *
 * **COROS is now attempted too** (Nov 2026 — the real `pushStructuredWorkoutToCorosMcp()`
 * schema was confirmed and built, see lib/integrations/corosMcp.ts's
 * file header) — previously skipped outright since it always threw the
 * same "not built yet" error for every workout regardless of
 * connection; now a real attempt, with COROS's own real constraints
 * (running/cycling only) surfaced as their own category below rather
 * than lumped into a generic failure.
 */
export interface WeekPushResult {
  sent: number;
  noSteps: number;
  noConnection: number;
  unsupportedSport: number;
  otherFailed: number;
}

function emptyResult(): WeekPushResult {
  return { sent: 0, noSteps: 0, noConnection: 0, unsupportedSport: 0, otherFailed: 0 };
}

async function pushWeekTo(workouts: WorkoutWithSlug[], endpoint: string, noConnectionNeedle: string): Promise<WeekPushResult> {
  const result = emptyResult();

  for (const w of workouts) {
    if (!w.workout_steps?.length) {
      result.noSteps += 1;
      continue;
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: w.id }),
      });
      if (res.ok) {
        result.sent += 1;
        continue;
      }
      const data = await res.json().catch(() => ({}));
      const error = typeof data.error === "string" ? data.error : "";
      if (error.includes(noConnectionNeedle)) {
        result.noConnection += 1;
      } else if (error.includes("can only schedule running or cycling")) {
        result.unsupportedSport += 1;
      } else {
        result.otherFailed += 1;
      }
    } catch {
      result.otherFailed += 1;
    }
  }

  return result;
}

export function pushWeekToGarmin(workouts: WorkoutWithSlug[]): Promise<WeekPushResult> {
  return pushWeekTo(workouts, "/api/garmin-dev/push", "has no Garmin Developer connection");
}

export function pushWeekToCoros(workouts: WorkoutWithSlug[]): Promise<WeekPushResult> {
  return pushWeekTo(workouts, "/api/coros/push", "has no COROS connection");
}

export interface WeekDeviceSyncResult {
  garmin: WeekPushResult;
  coros: WeekPushResult;
}

/** Runs both pushes and returns one combined status line — see
 * CLAUDE.md's "Download week now also sends to a watch" section. */
export async function pushWeekToDevices(workouts: WorkoutWithSlug[]): Promise<WeekDeviceSyncResult> {
  const [garmin, coros] = await Promise.all([pushWeekToGarmin(workouts), pushWeekToCoros(workouts)]);
  return { garmin, coros };
}

function platformLine(result: WeekPushResult, platform: string, isEn: boolean): string | null {
  const attempted = result.sent + result.noConnection + result.unsupportedSport + result.otherFailed;
  if (attempted === 0) return null; // nothing with structured steps was even attempted against this platform
  if (result.sent > 0) {
    return isEn ? `${platform}: sent ${result.sent} of ${attempted}.` : `${platform}: se mandaron ${result.sent} de ${attempted}.`;
  }
  if (result.noConnection === attempted) {
    return isEn ? `${platform}: not connected.` : `${platform}: no conectado.`;
  }
  if (result.unsupportedSport > 0 && result.unsupportedSport === attempted) {
    return isEn
      ? `${platform}: unsupported sport for every workout this week.`
      : `${platform}: deporte no soportado para todos los entrenos de esta semana.`;
  }
  return isEn ? `${platform}: send failed.` : `${platform}: falló el envío.`;
}

export function describeWeekDeviceSync(result: WeekDeviceSyncResult, isEn: boolean): string {
  const totalWithSteps =
    result.garmin.sent +
    result.garmin.noConnection +
    result.garmin.unsupportedSport +
    result.garmin.otherFailed || // Garmin and COROS see the same set of workouts, so either's "attempted" total works here
    result.coros.sent +
    result.coros.noConnection +
    result.coros.unsupportedSport +
    result.coros.otherFailed;

  if (totalWithSteps === 0) {
    return isEn
      ? "No workouts this week have structured steps to send to a watch yet."
      : "Ningún entreno de esta semana tiene pasos estructurados para mandar al reloj todavía.";
  }

  const lines = [platformLine(result.garmin, "Garmin", isEn), platformLine(result.coros, "COROS", isEn)].filter(
    (l): l is string => l !== null
  );
  return lines.join(" ");
}
