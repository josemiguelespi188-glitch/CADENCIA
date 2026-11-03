"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import {
  SPORTS,
  type Athlete,
  type AthleteSlug,
  type Sport,
  type Template,
  type Workout,
  type WorkoutStep,
  type WorkoutStepDurationType,
  type WorkoutStepKind,
  type WorkoutStepTargetType,
} from "@/lib/types";
import { ymd, today } from "@/lib/dates";
import { resolveHrZones, resolvePaceZones, resolvePowerZones, type HrZone, type PaceZone, type PowerZone, type ZoneKey } from "@/lib/zones";
import { templateTitle, templateNotes } from "@/lib/templates";

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
  workoutSteps: WorkoutStep[];
}

const STEP_KINDS: WorkoutStepKind[] = ["warmup", "work", "recovery", "cooldown", "rest"];
const DURATION_TYPES: WorkoutStepDurationType[] = ["time", "distance", "open"];
const TARGET_TYPES: WorkoutStepTargetType[] = ["pace", "hr", "power", "cadence", "open"];

function newStepId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

interface Props {
  /** null = closed. undefined date fields fall back to sensible defaults for a new workout. */
  editing: {
    record: WorkoutWithSlug | null;
    defaultDate?: string;
    defaultAthlete?: AthleteSlug;
    defaultSport?: Sport;
    /** Prefill from a Base Workouts preset, picked via NewWorkoutLauncher's
     * "Search for Workouts" screen — same fields applyTemplate() sets. */
    defaultTemplateId?: string;
  } | null;
  templates: Template[];
  /** Every athlete in the roster, for the athlete picker — the dynamic
   * replacement for the old hardcoded ATHLETES constant. */
  athletes: Athlete[];
  onClose: () => void;
  onSave: (value: WorkoutFormValue, existingId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EMPTY: WorkoutFormValue = {
  athleteSlug: "",
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
  workoutSteps: [],
};

export function WorkoutDialog({ editing, templates, athletes, onClose, onSave, onDelete }: Props) {
  const { t, locale } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<WorkoutFormValue>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [garminPushBusy, setGarminPushBusy] = useState(false);
  const [garminPushMessage, setGarminPushMessage] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  async function generateWorkoutFromAI() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/workouts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const data = await res.json();
      if (res.ok) {
        const steps: WorkoutStep[] = data.steps.map((s: Omit<WorkoutStep, "id">) => ({ ...s, id: newStepId() }));
        setValue((v) => ({
          ...v,
          sport: data.sport,
          title: data.title,
          workoutType: data.workoutType,
          minutes: data.minutes,
          km: data.km,
          notes: data.notes,
          workoutSteps: steps,
        }));
      } else {
        setAiMessage(data.error);
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function pushToCoros(workoutId: string) {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/coros/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId }),
      });
      const data = await res.json();
      setPushMessage(res.ok ? t("steps_push_ok") : data.error);
    } finally {
      setPushBusy(false);
    }
  }

  async function pushToGarmin(workoutId: string) {
    setGarminPushBusy(true);
    setGarminPushMessage(null);
    try {
      const res = await fetch("/api/garmin-dev/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId }),
      });
      const data = await res.json();
      setGarminPushMessage(res.ok ? t("steps_push_garmin_ok") : data.error);
    } finally {
      setGarminPushBusy(false);
    }
  }

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
            workoutSteps: r.workout_steps ?? [],
          }
        : (() => {
            const tpl = editing.defaultTemplateId ? templates.find((x) => x.id === editing.defaultTemplateId) : null;
            return {
              ...EMPTY,
              date: editing.defaultDate ?? EMPTY.date,
              athleteSlug: editing.defaultAthlete ?? athletes[0]?.slug ?? "",
              sport: tpl?.sport ?? editing.defaultSport ?? EMPTY.sport,
              title: tpl ? templateTitle(tpl, locale) : EMPTY.title,
              minutes: tpl?.minutes ?? EMPTY.minutes,
              km: tpl?.km ?? EMPTY.km,
              notes: tpl ? templateNotes(tpl, locale) : EMPTY.notes,
            };
          })()
    );
    setPushMessage(null);
    dialogRef.current?.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function applyTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setValue((v) => ({
      ...v,
      sport: tpl.sport,
      title: templateTitle(tpl, locale),
      minutes: tpl.minutes,
      km: tpl.km,
      notes: templateNotes(tpl, locale),
    }));
  }

  function addStep() {
    setValue((v) => ({
      ...v,
      workoutSteps: [
        ...v.workoutSteps,
        { id: newStepId(), kind: "work", durationType: "time", durationValue: 300, targetType: "open", targetLow: null, targetHigh: null, repeatCount: null },
      ],
    }));
  }

  function updateStep(id: string, patch: Partial<WorkoutStep>) {
    setValue((v) => ({ ...v, workoutSteps: v.workoutSteps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }

  function removeStep(id: string) {
    setValue((v) => ({ ...v, workoutSteps: v.workoutSteps.filter((s) => s.id !== id) }));
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

  // Real zones for whichever athlete this workout belongs to, so the
  // structured-step editor can offer "pick a zone" instead of making the
  // athlete look up and type their own bpm/pace/watts range by hand —
  // see StepRow's ZonePick below.
  const stepAthlete = athletes.find((a) => a.slug === value.athleteSlug) ?? null;
  const stepZones = {
    hr: stepAthlete ? resolveHrZones(stepAthlete).zones : null,
    pace: stepAthlete ? resolvePaceZones(stepAthlete) : null,
    power: stepAthlete ? resolvePowerZones(stepAthlete).zones : null,
  };

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    // Native <dialog> has no built-in "click outside to close" — a click
    // on the backdrop still targets the dialog element itself, so a
    // bounding-rect check (not e.target identity, which is unreliable
    // once the inner form's own padding/overflow is involved) tells a
    // real outside click apart from one inside the dialog's own box.
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
      className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(560px,calc(100vw-24px))] max-h-[calc(100dvh-24px)]"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-24px)] flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{isNew ? t("new_w") : t("edit_w")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="rounded-2xl border border-line-strong bg-surface-2 p-4">
          <label className="mb-1.5 block text-xs font-medium text-ink-2">{t("steps_ai_label")}</label>
          <textarea
            rows={2}
            placeholder={t("steps_ai_placeholder")}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              disabled={aiBusy || !aiPrompt.trim()}
              onClick={generateWorkoutFromAI}
              className="shrink-0 whitespace-nowrap"
            >
              {aiBusy ? t("steps_ai_generating") : t("steps_ai_generate")}
            </Button>
          </div>
          {aiMessage && <p className="mt-2 text-xs text-error">{aiMessage}</p>}
        </div>

        {templates.length > 0 && isNew && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{t("use")} · {t("tpl_h")}</label>
            <select
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
              defaultValue=""
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              <option value="">-</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.sport)} · {templateTitle(tpl, locale)}
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
              {athletes.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
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

          <div className="col-span-2 border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3">{t("steps_h")}</p>
              <Button type="button" variant="steel" size="sm" onClick={addStep}>
                + {t("steps_add")}
              </Button>
            </div>
            {value.workoutSteps.length === 0 ? (
              <p className="text-xs text-ink-3">{t("steps_empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {value.workoutSteps.map((step) => (
                  <StepRow key={step.id} step={step} zones={stepZones} onChange={(patch) => updateStep(step.id, patch)} onRemove={() => removeStep(step.id)} />
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-ink-3">{t("steps_hint")}</p>
            {!isNew && editing?.record && value.workoutSteps.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <Button
                    type="button"
                    variant="steel"
                    size="sm"
                    disabled={pushBusy}
                    onClick={() => editing.record && pushToCoros(editing.record.id)}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {pushBusy ? "…" : t("steps_push_coros")}
                  </Button>
                  {pushMessage && <span className="mt-2 text-xs text-ink-3 break-words">{pushMessage}</span>}
                </div>
                <div className="flex items-start gap-2">
                  <Button
                    type="button"
                    variant="steel"
                    size="sm"
                    disabled={garminPushBusy}
                    onClick={() => editing.record && pushToGarmin(editing.record.id)}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {garminPushBusy ? "…" : t("steps_push_garmin")}
                  </Button>
                  {garminPushMessage && <span className="mt-2 text-xs text-ink-3 break-words">{garminPushMessage}</span>}
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 flex items-center gap-2 border-t border-line pt-4">
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

const stepInputCls = "h-9 rounded-lg border border-line bg-bg px-2 text-xs";

/** Rounds to 1 decimal place — used to display seconds as minutes
 * without accumulating float noise (e.g. 150s -> 2.5, not 2.4999...). */
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Persistent unit label for a target value — shown next to the input
 * at all times (not just as a placeholder, which disappears the moment
 * something is typed and leaves a bare number with no unit at all). */
function targetUnit(targetType: WorkoutStepTargetType, t: (key: string) => string) {
  switch (targetType) {
    case "pace":
      return t("unit_pace");
    case "hr":
      return t("unit_bpm");
    case "power":
      return t("unit_watts");
    case "cadence":
      return t("unit_rpm");
    default:
      return "";
  }
}

/**
 * "Pick a zone" quick-fill for a step's HR/pace/power target — sets
 * targetLow/targetHigh to that athlete's own real zone range (Strava's
 * if configured, else computed from their threshold, same resolution
 * ZoneTables uses — see lib/zones.ts's resolve*Zones()) instead of
 * making the athlete look up and type the bpm/pace/watts range by
 * hand. A one-shot action select, not a persistently-controlled value
 * — picking a zone doesn't lock the field to exactly that band,
 * targetLow/targetHigh stay freely editable in the inputs above.
 */
function ZonePick<Z extends { key: ZoneKey }>({
  zones,
  toRange,
  onPick,
}: {
  zones: Z[];
  toRange: (zone: Z) => [number | null, number | null];
  onPick: (low: number | null, high: number | null) => void;
}) {
  const { t } = useLocale();
  return (
    <select
      onChange={(e) => {
        const key = e.target.value;
        if (!key) return;
        const zone = zones.find((z) => z.key === key);
        if (zone) onPick(...toRange(zone));
        e.target.value = "";
      }}
      defaultValue=""
      className={stepInputCls + " col-span-2 sm:col-span-6"}
    >
      <option value="">{t("steps_zone_pick")}</option>
      {zones.map((z) => (
        <option key={z.key} value={z.key}>
          {t(`zone_${z.key}`)}
        </option>
      ))}
    </select>
  );
}

/**
 * One row of a structured workout — a minimal, functional editor (not a
 * fancy drag/drop builder) so the "Structured Workouts and Training Plans
 * Sync" capability applied for with COROS has real Cadencia-side data to
 * push, once that integration is actually wired up. See
 * lib/integrations/coros.ts for why the push itself is still unconfirmed.
 */
interface StepZones {
  hr: HrZone[] | null;
  pace: PaceZone[] | null;
  power: PowerZone[] | null;
}

function StepRow({
  step,
  zones,
  onChange,
  onRemove,
}: {
  step: WorkoutStep;
  zones: StepZones;
  onChange: (patch: Partial<WorkoutStep>) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line p-2 sm:grid-cols-6">
      <select value={step.kind} onChange={(e) => onChange({ kind: e.target.value as WorkoutStepKind })} className={stepInputCls}>
        {STEP_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`step_${k}`)}
          </option>
        ))}
      </select>
      {/* Found live (Nov 2026, full codebase audit): switching between
          "time" and "distance" used to keep durationValue's raw number
          unchanged, silently reinterpreting its unit (e.g. 5000 meters
          became "5000 seconds" the instant the dropdown flipped to
          "time"). Always resets on a type change now — the old value's
          unit no longer applies, so there's nothing safe to carry over. */}
      <select
        value={step.durationType}
        onChange={(e) => onChange({ durationType: e.target.value as WorkoutStepDurationType, durationValue: null })}
        className={stepInputCls}
      >
        {DURATION_TYPES.map((d) => (
          <option key={d} value={d}>
            {t(`duration_${d}`)}
          </option>
        ))}
      </select>
      {step.durationType !== "open" && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={step.durationType === "time" ? 0.5 : 1}
            placeholder={step.durationType === "time" ? t("duration_time") : t("duration_distance")}
            value={step.durationType === "time" ? (step.durationValue !== null ? round1(step.durationValue / 60) : "") : (step.durationValue ?? "")}
            onChange={(e) => {
              if (!e.target.value) return onChange({ durationValue: null });
              const n = Number(e.target.value);
              onChange({ durationValue: step.durationType === "time" ? Math.round(n * 60) : n });
            }}
            className={stepInputCls + " min-w-0 flex-1"}
          />
          <span className="shrink-0 text-[10px] text-ink-3">{step.durationType === "time" ? t("unit_min") : t("unit_m")}</span>
        </div>
      )}
      {/* Same reset-on-type-change fix as durationType above — a pace of
          "300" (sec/km) must not survive as "HR 300 bpm" when the
          dropdown switches. */}
      <select
        value={step.targetType}
        onChange={(e) => onChange({ targetType: e.target.value as WorkoutStepTargetType, targetLow: null, targetHigh: null })}
        className={stepInputCls}
      >
        {TARGET_TYPES.map((tt) => (
          <option key={tt} value={tt}>
            {t(`target_${tt}`)}
          </option>
        ))}
      </select>
      {step.targetType !== "open" && (
        <>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder={t("target_low")}
              value={step.targetLow ?? ""}
              onChange={(e) => onChange({ targetLow: e.target.value ? Number(e.target.value) : null })}
              className={stepInputCls + " min-w-0 flex-1"}
            />
            <span className="shrink-0 text-[10px] text-ink-3">{targetUnit(step.targetType, t)}</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder={t("target_high")}
              value={step.targetHigh ?? ""}
              onChange={(e) => onChange({ targetHigh: e.target.value ? Number(e.target.value) : null })}
              className={stepInputCls + " min-w-0 flex-1"}
            />
            <span className="shrink-0 text-[10px] text-ink-3">{targetUnit(step.targetType, t)}</span>
          </div>
        </>
      )}
      {step.targetType === "hr" && zones.hr && (
        <ZonePick
          zones={zones.hr}
          toRange={(z) => [z.min, z.max]}
          onPick={(low, high) => onChange({ targetLow: low, targetHigh: high })}
        />
      )}
      {step.targetType === "pace" && zones.pace && (
        <ZonePick
          zones={zones.pace}
          toRange={(z) => [z.fastSecPerKm, z.slowSecPerKm]}
          onPick={(low, high) => onChange({ targetLow: low, targetHigh: high })}
        />
      )}
      {step.targetType === "power" && zones.power && (
        <ZonePick
          zones={zones.power}
          toRange={(z) => [z.min, z.max]}
          onPick={(low, high) => onChange({ targetLow: low, targetHigh: high })}
        />
      )}
      <div className="col-span-2 flex items-center gap-1.5 sm:col-span-6">
        <input
          type="number"
          min={1}
          placeholder={t("steps_repeat")}
          value={step.repeatCount ?? ""}
          onChange={(e) => onChange({ repeatCount: e.target.value ? Number(e.target.value) : null })}
          className={stepInputCls + " w-28"}
        />
        <Button type="button" variant="danger" size="sm" onClick={onRemove} className="ml-auto">
          ×
        </Button>
      </div>
    </div>
  );
}
