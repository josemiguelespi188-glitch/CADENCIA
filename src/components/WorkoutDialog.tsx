"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { ATHLETES, SPORTS, type AthleteSlug, type Sport, type Template, type Workout } from "@/lib/types";
import { ymd, today } from "@/lib/dates";

export type WorkoutWithSlug = Workout & { athleteSlug: AthleteSlug };

export interface WorkoutFormValue {
  athleteSlug: AthleteSlug;
  date: string;
  sport: Sport;
  title: string;
  workoutType: string;
  start: string;
  minutes: number;
  km: number;
  notes: string;
  stravaComment: string;
  done: boolean;
  rpe: number | null;
}

interface Props {
  /** null = closed. undefined date fields fall back to sensible defaults for a new workout. */
  editing: { record: WorkoutWithSlug | null; defaultDate?: string; defaultAthlete?: AthleteSlug } | null;
  templates: Template[];
  onClose: () => void;
  onSave: (value: WorkoutFormValue, existingId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EMPTY: WorkoutFormValue = {
  athleteSlug: "juan",
  date: ymd(today()),
  sport: "run",
  title: "",
  workoutType: "",
  start: "",
  minutes: 0,
  km: 0,
  notes: "",
  stravaComment: "",
  done: false,
  rpe: null,
};

export function WorkoutDialog({ editing, templates, onClose, onSave, onDelete }: Props) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<WorkoutFormValue>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      dialogRef.current?.close();
      return;
    }
    const r = editing.record;
    // Syncing local form state to the `editing` prop that just opened the
    // dialog — not state derived from render, so there's no way to compute
    // this without an effect (or a key-reset hack that would fight the
    // native <dialog> open/close lifecycle below).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(
      r
        ? {
            athleteSlug: r.athleteSlug,
            date: r.date,
            sport: r.sport,
            title: r.title,
            workoutType: r.workout_type,
            start: r.start ?? "",
            minutes: r.minutes,
            km: r.km,
            notes: r.notes,
            stravaComment: r.strava_comment,
            done: r.done,
            rpe: r.rpe,
          }
        : {
            ...EMPTY,
            date: editing.defaultDate ?? EMPTY.date,
            athleteSlug: editing.defaultAthlete ?? EMPTY.athleteSlug,
          }
    );
    dialogRef.current?.showModal();
  }, [editing]);

  function applyTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setValue((v) => ({ ...v, sport: tpl.sport, title: tpl.title, minutes: tpl.minutes, km: tpl.km, notes: tpl.notes }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(value, editing?.record?.id ?? null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isNew = !editing?.record;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(560px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
        <h2 className="text-xl font-semibold tracking-tight">{isNew ? t("new_w") : t("edit_w")}</h2>

        {templates.length > 0 && isNew && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{t("use")} — {t("tpl_h")}</label>
            <select
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
              defaultValue=""
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              <option value="">—</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.sport)} · {tpl.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("athlete")}>
            <select
              value={value.athleteSlug}
              onChange={(e) => setValue((v) => ({ ...v, athleteSlug: e.target.value as AthleteSlug }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              {(Object.keys(ATHLETES) as AthleteSlug[]).map((slug) => (
                <option key={slug} value={slug}>
                  {ATHLETES[slug].name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("date")}>
            <input
              type="date"
              required
              value={value.date}
              onChange={(e) => setValue((v) => ({ ...v, date: e.target.value }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("sport")}>
            <select
              value={value.sport}
              onChange={(e) => setValue((v) => ({ ...v, sport: e.target.value as Sport }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("start")}>
            <input
              type="time"
              value={value.start}
              onChange={(e) => setValue((v) => ({ ...v, start: e.target.value }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("title")} full>
            <input
              type="text"
              maxLength={120}
              value={value.title}
              onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("workout_type")} full>
            <input
              type="text"
              maxLength={60}
              placeholder="Tempo, Series, Rodaje suave..."
              value={value.workoutType}
              onChange={(e) => setValue((v) => ({ ...v, workoutType: e.target.value }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("min")}>
            <input
              type="number"
              min={0}
              max={900}
              step={5}
              value={value.minutes}
              onChange={(e) => setValue((v) => ({ ...v, minutes: Number(e.target.value) || 0 }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("km")}>
            <input
              type="number"
              min={0}
              max={300}
              step={0.1}
              value={value.km}
              onChange={(e) => setValue((v) => ({ ...v, km: Number(e.target.value) || 0 }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </Field>
          <Field label={t("notes")} full>
            <textarea
              maxLength={1500}
              value={value.notes}
              onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))}
              className="min-h-24 resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            />
          </Field>
          <Field label={t("strava_comment")} full>
            <textarea
              maxLength={1000}
              value={value.stravaComment}
              onChange={(e) => setValue((v) => ({ ...v, stravaComment: e.target.value }))}
              className="min-h-16 resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            />
            <p className="text-xs text-ink-3">{t("strava_comment_hint")}</p>
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <input
              id="done"
              type="checkbox"
              checked={value.done}
              onChange={(e) => setValue((v) => ({ ...v, done: e.target.checked }))}
              className="h-5 w-5"
            />
            <label htmlFor="done" className="text-sm">
              {t("is_done")}
            </label>
          </div>
          {value.done && (
            <Field label={`${t("rpe")}${value.rpe !== null ? `: ${value.rpe}` : ""}`} full>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={value.rpe ?? 0}
                onChange={(e) => setValue((v) => ({ ...v, rpe: Number(e.target.value) }))}
                className="w-full"
              />
              <p className="text-xs text-ink-3">{t("rpe_hint")}</p>
            </Field>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!isNew && editing?.record && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => editing.record && onDelete(editing.record.id).then(onClose)}
            >
              {t("del")}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {t("save")}
            </Button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "col-span-2" : ""}`}>
      <label className="text-xs text-ink-2">{label}</label>
      {children}
    </div>
  );
}
