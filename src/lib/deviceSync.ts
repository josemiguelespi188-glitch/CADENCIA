import type { WorkoutWithSlug } from "@/components/WorkoutDialog";

/**
 * "Send week to watch" (Nov 2026, direct instruction: "el boton de
 * download week tiene que hacer dos cosas. UNO MANDAR LA semana al reloj
 * o cuenta de garmin o coros. 2 descargar al calendario de apple los
 * entrenos.") — see CLAUDE.md's "Download week now also sends to a
 * watch" section. One POST to the existing single-workout
 * `/api/garmin-dev/push` route per workout, sequential (a week is at
 * most ~7-14 rows, no need for `/api/strava/sync`'s own concurrency
 * batching built for up to 200).
 *
 * **COROS is deliberately not attempted here at all** —
 * `pushStructuredWorkoutToCorosMcp()` always throws the exact same "not
 * built yet" error regardless of whether that athlete is connected (see
 * lib/integrations/corosMcp.ts's own header), so looping a real network
 * call per workout against it would just add noise for an outcome
 * that's already known ahead of time. `describeWeekGarminPushResult`
 * mentions this limitation in its own message instead, only in the one
 * case where it's actually relevant (Garmin isn't connected either).
 */
export interface WeekGarminPushResult {
  sent: number;
  noSteps: number;
  noConnection: number;
  otherFailed: number;
}

export async function pushWeekToGarmin(workouts: WorkoutWithSlug[]): Promise<WeekGarminPushResult> {
  const result: WeekGarminPushResult = { sent: 0, noSteps: 0, noConnection: 0, otherFailed: 0 };

  for (const w of workouts) {
    if (!w.workout_steps?.length) {
      result.noSteps += 1;
      continue;
    }
    try {
      const res = await fetch("/api/garmin-dev/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: w.id }),
      });
      if (res.ok) {
        result.sent += 1;
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (typeof data.error === "string" && data.error.includes("has no Garmin Developer connection")) {
        result.noConnection += 1;
      } else {
        result.otherFailed += 1;
      }
    } catch {
      result.otherFailed += 1;
    }
  }

  return result;
}

export function describeWeekGarminPushResult(result: WeekGarminPushResult, isEn: boolean): string {
  const attempted = result.sent + result.noConnection + result.otherFailed;

  if (attempted === 0) {
    return isEn
      ? "No workouts this week have structured steps to send to a watch yet."
      : "Ningún entreno de esta semana tiene pasos estructurados para mandar al reloj todavía.";
  }

  if (result.sent > 0) {
    const base = isEn ? `Sent ${result.sent} of ${attempted} workout(s) to Garmin.` : `Se mandaron ${result.sent} de ${attempted} entreno(s) a Garmin.`;
    const extra =
      result.noSteps > 0
        ? isEn
          ? ` ${result.noSteps} workout(s) have no structured steps yet.`
          : ` ${result.noSteps} entreno(s) no tienen pasos estructurados todavía.`
        : "";
    return base + extra;
  }

  if (result.noConnection === attempted) {
    return isEn
      ? "This athlete hasn't connected Garmin yet (connect from Settings to send workouts to a watch). COROS push isn't built yet either."
      : "Este atleta todavía no ha conectado Garmin (conéctalo desde Ajustes para mandar entrenos al reloj). El envío a COROS tampoco está disponible todavía.";
  }

  return isEn ? "Sending this week's workouts to Garmin failed." : "Falló el envío de los entrenos de esta semana a Garmin.";
}
