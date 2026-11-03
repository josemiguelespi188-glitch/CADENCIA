"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { SPORTS, type Sport, type Template } from "@/lib/types";
import { templateTitle, templateNotes } from "@/lib/templates";
import { fmt, parseYmd } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The first screen shown when adding a new workout — a TrainingPeaks-
 * style launcher (date heading, three entry points) in front of the
 * actual WorkoutDialog form, rather than opening straight into a blank
 * form. Originally just "Build with AI" + a sport-icon grid; a third
 * entry point, "Search for Workouts", was added (Nov 2026, direct
 * complaint: "no entiendo de qué sirve el Base Workouts si es que no hay
 * cómo añadir al calendario... cuando pongo Create Workout debería
 * también tener la opción de buscar un workout de la base de Base
 * Workouts") so a preset saved on /templates is actually reachable from
 * the calendar, not just a dead-end list. No new sport types beyond
 * Cadencia's existing six (five original + "brick", added the same
 * pass — see CLAUDE.md's "Base Workouts: search, bilingual text, brick
 * sport" section) — TrainingPeaks' own reference shows far more
 * (XC-Ski, Rowing, etc.) that this app still doesn't model.
 *
 * Picking a sport, the AI generator, or a searched preset all hand off
 * to the same WorkoutDialog underneath — this is purely a nicer entry
 * point, not a second place workout data lives.
 */
export function NewWorkoutLauncher({
  date,
  templates,
  onClose,
  onPickSport,
  onPickAI,
  onPickTemplate,
}: {
  /** The date this new workout will default to — null closes the launcher. */
  date: string | null;
  templates: Template[];
  onClose: () => void;
  onPickSport: (sport: Sport) => void;
  onPickAI: () => void;
  onPickTemplate: (tpl: Template) => void;
}) {
  const { t, locale } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"menu" | "search">("menu");
  const [query, setQuery] = useState("");
  const [sportFilter, setSportFilter] = useState<Sport | "">("");

  useEffect(() => {
    if (date) dialogRef.current?.showModal();
    else dialogRef.current?.close();
    // Reset back to the main menu every time the launcher re-opens, so it
    // never reopens mid-search from a previous day.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("menu");
    setQuery("");
    setSportFilter("");
  }, [date]);

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    const dialogEl = dialogRef.current;
    if (!dialogEl || e.target !== dialogEl) return;
    const rect = dialogEl.getBoundingClientRect();
    const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outside) onClose();
  }

  const heading = date ? fmt(parseYmd(date), locale === "es" ? "es" : "en", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (sportFilter && tpl.sport !== sportFilter) return false;
      if (!q) return true;
      return templateTitle(tpl, locale).toLowerCase().includes(q) || templateNotes(tpl, locale).toLowerCase().includes(q);
    });
  }, [templates, sportFilter, query, locale]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleDialogClick}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(480px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      <div className="flex max-h-[calc(100dvh-24px)] flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight capitalize">
            {mode === "search" ? t("launcher_search_workouts") : heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        {mode === "menu" ? (
          <>
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
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3">{t("launcher_search_workouts")}</p>
              <button
                type="button"
                onClick={() => setMode("search")}
                className="flex w-full items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-line"
              >
                <SearchIcon />
                {t("launcher_search_from_base")}
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
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search_workouts_placeholder")}
                className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
              />
              <select
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value as Sport | "")}
                className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
              >
                <option value="">{t("search_workouts_all_sports")}</option>
                {SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-3">{t("search_workouts_empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => onPickTemplate(tpl)}
                    className={cn("s-" + tpl.sport, "flex flex-col gap-1 rounded-xl border border-line p-3 text-left transition-colors hover:bg-surface-2")}
                  >
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--c)" }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--c)" }} />
                      {t(tpl.sport)}
                      {tpl.minutes ? ` · ${tpl.minutes} min` : ""}
                      {tpl.km ? ` · ${tpl.km} km` : ""}
                    </span>
                    <span className="text-sm font-medium text-ink">{templateTitle(tpl, locale)}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setMode("menu")}
              className="self-start text-xs font-medium text-ink-2 underline transition-colors hover:text-ink"
            >
              ← {t("search_workouts_back")}
            </button>
          </>
        )}
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

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}
