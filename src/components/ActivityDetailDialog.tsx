"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import type { StravaActivity } from "@/lib/types";
import { fmt, hm, paceLabel } from "@/lib/dates";
import { mapStravaSportType } from "@/lib/sport";

/**
 * We only store a handful of summary fields per synced activity (see
 * CLAUDE.md) — this dialog is the "see more" escape hatch: a quick look
 * at what we do have, plus a direct link to the real Strava activity page
 * (map, splits, laps, everything else Strava captured that we don't).
 */
export function ActivityDetailDialog({ activity, onClose }: { activity: StravaActivity | null; onClose: () => void }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (activity) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [activity]);

  const sport = activity ? mapStravaSportType(activity.sport_type) : null;
  const pace = activity && activity.distance_m ? Math.round(activity.moving_time_s / (activity.distance_m / 1000)) : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(480px,calc(100vw-24px))]"
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
            {activity.average_cadence ? <Stat label={isEn ? "Cadence" : "Cadencia"} value={String(Math.round(activity.average_cadence))} /> : null}
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
