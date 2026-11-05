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
 *
 * Also has a "Strava Description" box (Nov 2026, direct complaint: "no
 * deja poner comentarios en la actividad") that pushes straight to the
 * real Strava activity via `POST /api/strava/activities/[id]/description`
 * — works whether this activity is matched to a workout or not (unlike
 * `WorkoutDialog`'s own field by the same name, which only ever exists on
 * a planned workout). See CLAUDE.md's "Auto-sync Strava" / "strava
 * comment" sections for how this interacts with the sync route's own
 * matching retry.
 */
export function ActivityDetailDialog({ activity, onClose }: { activity: StravaActivity | null; onClose: () => void }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [matchedWorkout, setMatchedWorkout] = useState<Workout | null>(null);
  const [description, setDescription] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionSaved, setDescriptionSaved] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  useEffect(() => {
    // Found live (Nov 2026, full codebase audit): this had no staleness
    // guard, unlike ActivityMap.tsx's own correct `cancelled` pattern —
    // opening activity A then quickly B before A's fetch resolved could
    // overwrite matchedWorkout with A's data while B's dialog was shown.
    let cancelled = false;
    if (activity) {
      dialogRef.current?.showModal();
      const supabase = createClient();
      supabase
        .from("workouts")
        .select("*")
        .eq("strava_activity_id", activity.id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const w = (data as Workout) ?? null;
          setMatchedWorkout(w);
          setDescription(w?.strava_comment ?? "");
        });
    } else {
      dialogRef.current?.close();
      // Resetting local state to match the `activity` prop going null —
      // same pattern as WorkoutDialog's own form-reset effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatchedWorkout(null);
      setDescription("");
      setDescriptionSaved(false);
      setDescriptionError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [activity]);

  const sport = activity ? mapStravaSportType(activity.sport_type) : null;
  const pace = activity && activity.distance_m ? Math.round(activity.moving_time_s / (activity.distance_m / 1000)) : null;

  async function saveDescription() {
    if (!activity || !description.trim()) return;
    setSavingDescription(true);
    setDescriptionSaved(false);
    setDescriptionError(null);
    try {
      const res = await fetch(`/api/strava/activities/${activity.id}/description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDescriptionError(data.error ?? (isEn ? "Could not save." : "No se pudo guardar."));
        return;
      }
      setDescriptionSaved(true);
    } finally {
      setSavingDescription(false);
    }
  }

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    // Same click-outside-to-close handler as WorkoutDialog/NewWorkoutLauncher
    // — see WorkoutDialog.tsx's own comment for why this needs a
    // bounding-rect check rather than e.target identity.
    const dialogEl = dialogRef.current;
    if (!dialogEl || e.target !== dialogEl) return;
    const rect = dialogEl.getBoundingClientRect();
    const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleDialogClick}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(520px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      {activity && (
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{activity.sport_type}</p>
              <h2 className="text-xl font-semibold tracking-tight">{activity.name}</h2>
              <p className="mt-0.5 text-xs text-ink-3">{fmt(new Date(activity.start_date), locale, { weekday: "long", day: "numeric", month: "long" })}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("cancel")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label={isEn ? "Duration" : "Duración"} value={hm(activity.moving_time_s / 60, locale as "es" | "en")} />
            <Stat label={isEn ? "Distance" : "Distancia"} value={activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : "N/A"} />
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
                    <ComparisonRow label={isEn ? "Duration" : "Duración"} planned={matchedWorkout.minutes ? hm(matchedWorkout.minutes, locale as "es" | "en") : "N/A"} completed={hm(activity.moving_time_s / 60, locale as "es" | "en")} />
                    <ComparisonRow
                      label={isEn ? "Distance" : "Distancia"}
                      planned={matchedWorkout.km ? `${matchedWorkout.km} km` : "N/A"}
                      completed={activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : "N/A"}
                    />
                    {matchedWorkout.rpe !== null && <ComparisonRow label={t("rpe")} planned="N/A" completed={String(matchedWorkout.rpe)} />}
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

          <div>
            <label htmlFor="activity-description" className="mb-2 block text-xs font-semibold uppercase tracking-widest text-ink-3">
              {t("strava_comment")}
            </label>
            <textarea
              id="activity-description"
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescriptionSaved(false);
                setDescriptionError(null);
              }}
              placeholder={isEn ? "Write a description and push it to Strava…" : "Escribe una descripción y pásala a Strava…"}
              className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
            />
            <p className="mt-1 text-xs text-ink-3">{t("strava_comment_hint")}</p>
            <div className="mt-2 flex items-center gap-3">
              <Button type="button" size="sm" onClick={saveDescription} disabled={savingDescription || !description.trim()}>
                {savingDescription ? (isEn ? "Saving…" : "Guardando…") : t("save")}
              </Button>
              {descriptionSaved && <span className="text-xs text-ink-3">{t("saved")}</span>}
              {descriptionError && <span className="text-xs text-error">{descriptionError}</span>}
            </div>
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
