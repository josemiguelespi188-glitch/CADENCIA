"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { StravaActivity, Workout } from "@/lib/types";
import { fmt, hm, paceLabel } from "@/lib/dates";
import { mapStravaSportType } from "@/lib/sport";
import { ActivityMap } from "@/components/ActivityMap";

/**
 * We only store a handful of summary fields per synced activity (see
 * CLAUDE.md) — this dialog is the "see more" escape hatch: a quick look
 * at what we do have, plus a direct link to the real Strava activity page
 * (map, splits, laps, everything else Strava captured that we don't). When
 * this activity is linked to a planned workout, it also shows a Planned
 * vs. Completed comparison (per explicit request, modeled on TrainingPeaks'
 * own activity detail view) — see CLAUDE.md's "Planned vs Completed" note.
 */
export function ActivityDetailDialog({ activity, onClose }: { activity: StravaActivity | null; onClose: () => void }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [matchedWorkout, setMatchedWorkout] = useState<Workout | null>(null);

  useEffect(() => {
    if (activity) {
      dialogRef.current?.showModal();
      const supabase = createClient();
      supabase
        .from("workouts")
        .select("*")
        .eq("strava_activity_id", activity.id)
        .maybeSingle()
        .then(({ data }) => setMatchedWorkout((data as Workout) ?? null));
    } else {
      dialogRef.current?.close();
      // Resetting local state to match the `activity` prop going null —
      // same pattern as WorkoutDialog's own form-reset effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatchedWorkout(null);
    }
  }, [activity]);

  const sport = activity ? mapStravaSportType(activity.sport_type) : null;
  const pace = activity && activity.distance_m ? Math.round(activity.moving_time_s / (activity.distance_m / 1000)) : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(520px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      {activity && (
        <div className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{activity.sport_type}</p>
            <h2 className="text-xl font-semibold tracking-tight">{activity.name}</h2>
            <p className="mt-0.5 text-xs text-ink-3">{fmt(new Date(activity.start_date), locale, { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label={isEn ? "Duration" : "Duración"} value={hm(activity.moving_time_s / 60, locale as "es" | "en")} />
            <Stat label={isEn ? "Distance" : "Distancia"} value={activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : "—"} />
            {sport === "run" && pace && <Stat label={isEn ? "Pace" : "Ritmo"} value={paceLabel(pace)} />}
            {activity.average_speed ? <Stat label={isEn ? "Avg speed" : "Vel. prom."} value={`${(activity.average_speed * 3.6).toFixed(1)} km/h`} /> : null}
            {activity.average_heart_rate ? <Stat label={isEn ? "Avg HR" : "FC prom."} value={`${Math.round(activity.average_heart_rate)} bpm`} /> : null}
            {activity.max_heart_rate ? <Stat label={isEn ? "Max HR" : "FC máx."} value={`${Math.round(activity.max_heart_rate)} bpm`} /> : null}
            {activity.average_cadence ? <Stat label={isEn ? "Cadence" : "Cadencia"} value={String(Math.round(activity.average_cadence))} /> : null}
            {activity.average_watts ? <Stat label={isEn ? "Avg power" : "Potencia prom."} value={`${Math.round(activity.average_watts)} W`} /> : null}
            {activity.total_elevation_gain_m ? <Stat label={isEn ? "Elevation" : "Elevación"} value={`${Math.round(activity.total_elevation_gain_m)} m`} /> : null}
            {activity.calories ? <Stat label={isEn ? "Calories" : "Calorías"} value={`${Math.round(activity.calories)} kcal`} /> : null}
            {activity.relative_effort ? <Stat label="Relative Effort" value={String(Math.round(activity.relative_effort))} /> : null}
            {activity.gear_name ? <Stat label={t("gear")} value={activity.gear_name} /> : null}
          </div>

          <ActivityMap polyline={activity.raw?.map?.summary_polyline} />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">{t("planned_vs_completed")}</p>
            {matchedWorkout ? (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 text-left text-[10px] uppercase tracking-widest text-ink-3">
                      <th className="px-3 py-2 font-semibold"> </th>
                      <th className="px-3 py-2 font-semibold">{t("planned_label")}</th>
                      <th className="px-3 py-2 font-semibold">{t("completed_label")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ComparisonRow label={isEn ? "Duration" : "Duración"} planned={matchedWorkout.minutes ? hm(matchedWorkout.minutes, locale as "es" | "en") : "—"} completed={hm(activity.moving_time_s / 60, locale as "es" | "en")} />
                    <ComparisonRow
                      label={isEn ? "Distance" : "Distancia"}
                      planned={matchedWorkout.km ? `${matchedWorkout.km} km` : "—"}
                      completed={activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : "—"}
                    />
                    {matchedWorkout.rpe !== null && <ComparisonRow label={t("rpe")} planned="—" completed={String(matchedWorkout.rpe)} />}
                  </tbody>
                </table>
                {matchedWorkout.notes && (
                  <p className="border-t border-line px-3 py-2 text-xs text-ink-2">
                    <span className="font-semibold">{matchedWorkout.title}:</span> {matchedWorkout.notes}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-3">{t("no_plan_matched")}</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <a href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer">
              <Button size="sm">{isEn ? "Open in Strava" : "Ver en Strava"}</Button>
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
    </div>
  );
}

function ComparisonRow({ label, planned, completed }: { label: string; planned: string; completed: string }) {
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2 text-ink-2">{label}</td>
      <td className="px-3 py-2 tabular-nums text-ink-3">{planned}</td>
      <td className="px-3 py-2 tabular-nums font-medium">{completed}</td>
    </tr>
  );
}
