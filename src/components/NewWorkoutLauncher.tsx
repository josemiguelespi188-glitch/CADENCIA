"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/lib/i18n/context";
import { SPORTS, type Sport } from "@/lib/types";
import { fmt, parseYmd } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The first screen shown when adding a new workout — a TrainingPeaks-
 * style launcher (date heading, "Build with AI" entry point, a grid of
 * sport icons) in front of the actual WorkoutDialog form, rather than
 * opening straight into a blank form. Built per explicit instruction,
 * scoped narrowly to what Cadencia already has: no Goals/Metrics/
 * Availability sections or device-file upload (all present in the
 * TrainingPeaks reference screenshot but not concepts this app has —
 * confirmed out of scope via AskUserQuestion) and no new sport types
 * beyond Cadencia's existing five (TrainingPeaks' own reference shows
 * far more, e.g. Brick/XC-Ski/Rowing, that this app doesn't model).
 *
 * Picking a sport or the AI generator both hand off to the same
 * WorkoutDialog underneath — this is purely a nicer entry point, not a
 * second place workout data lives.
 */
export function NewWorkoutLauncher({
  date,
  onClose,
  onPickSport,
  onPickAI,
}: {
  /** The date this new workout will default to — null closes the launcher. */
  date: string | null;
  onClose: () => void;
  onPickSport: (sport: Sport) => void;
  onPickAI: () => void;
}) {
  const { t, locale } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (date) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [date]);

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    const dialogEl = dialogRef.current;
    if (!dialogEl || e.target !== dialogEl) return;
    const rect = dialogEl.getBoundingClientRect();
    const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside) onClose();
  }

  const heading = date ? fmt(parseYmd(date), locale === "es" ? "es" : "en", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleDialogClick}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(480px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      <div className="flex max-h-[calc(100dvh-24px)] flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight capitalize">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3">{t("launcher_build_ai")}</p>
          <button
            type="button"
            onClick={onPickAI}
            className="flex w-full items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line"
          >
            <SparkleIcon />
            {t("launcher_workout_generator")}
          </button>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3">{t("launcher_add_workout")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SPORTS.map((sport) => (
              <button
                key={sport}
                type="button"
                onClick={() => onPickSport(sport)}
                className={cn("s-" + sport, "flex items-center gap-2.5 rounded-xl border border-line p-3 text-left transition-colors hover:bg-surface-2")}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--soft)" }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--c)" }} />
                </span>
                <span className="text-sm font-medium text-ink">{t(sport)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5l1.2 3.8L13 6.5 9.2 7.7 8 11.5 6.8 7.7 3 6.5l3.8-1.2L8 1.5z" />
      <path d="M13 11l.6 1.9L15.5 13.5 13.6 14.1 13 16l-.6-1.9L10.5 13.5l1.9-.6L13 11z" opacity="0.7" />
    </svg>
  );
}
