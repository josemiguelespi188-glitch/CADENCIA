"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SPORTS, type Athlete, type AthleteSlug, type PersonalBest, type Sport } from "@/lib/types";
import { durationLabel, parseDuration } from "@/lib/dates";
import { DISTANCE_PRESETS, predictRaceTimes } from "@/lib/racePredictor";
import { ZoneTables } from "@/components/ZoneTables";

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * The comprehensive "triathlete profile" questionnaire — per explicit
 * request (Oct 2026): "tiene que verse así de completo como el perfil
 * de un triatleta... porque de ahí la idea es que tú en el Excel pases
 * toda la información del triatleta para que cuando tú cargues en un
 * agente de cloud, los entrenamientos que haga, haga en función a toda
 * esta información." None of that downstream AI-plan-generation or
 * Excel-export wiring is built yet (see CLAUDE.md's Roadmap) — this
 * card is the data-entry layer those future features will read from.
 * Deliberately separate from the existing Training Zones card (LTHR/
 * FTP/VO2max/pace) just below it on /settings — that one already
 * existed and still owns those four numbers.
 */
export function AthleteProfileCard({ slug }: { slug: AthleteSlug }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";

  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<"" | "male" | "female" | "other">("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [restingHr, setRestingHr] = useState("");
  const [maxHr, setMaxHr] = useState("");
  const [goalRaceName, setGoalRaceName] = useState("");
  const [goalRaceDate, setGoalRaceDate] = useState("");
  const [goalDistance, setGoalDistance] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [isCoach, setIsCoach] = useState(false);
  const [bests, setBests] = useState<PersonalBest[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("athletes").select("*").eq("slug", slug).maybeSingle();
    const a = data as Athlete | null;
    setAthlete(a);
    setBirthDate(a?.birth_date ?? "");
    setSex((a?.sex as "male" | "female" | "other" | null) ?? "");
    setHeightCm(a?.height_cm ? String(a.height_cm) : "");
    setWeightKg(a?.weight_kg ? String(a.weight_kg) : "");
    setRestingHr(a?.resting_hr ? String(a.resting_hr) : "");
    setMaxHr(a?.max_hr ? String(a.max_hr) : "");
    setGoalRaceName(a?.goal_race_name ?? "");
    setGoalRaceDate(a?.goal_race_date ?? "");
    setGoalDistance(a?.goal_distance ?? "");
    setGoalNotes(a?.goal_notes ?? "");
    setIsCoach(a?.is_coach ?? false);
    setBests(a?.personal_bests ?? []);
  }, [slug]);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function addBest() {
    setBests((prev) => [
      ...prev,
      { id: newId(), sport: "run", distanceLabel: "5K", distanceMeters: 5000, timeSec: 0, date: "", raceName: "" },
    ]);
  }

  function updateBest(id: string, patch: Partial<PersonalBest>) {
    setBests((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBest(id: string) {
    setBests((prev) => prev.filter((b) => b.id !== id));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("athletes")
        .update({
          birth_date: birthDate || null,
          sex: sex || null,
          height_cm: heightCm ? Number(heightCm) : null,
          weight_kg: weightKg ? Number(weightKg) : null,
          resting_hr: restingHr ? Number(restingHr) : null,
          max_hr: maxHr ? Number(maxHr) : null,
          goal_race_name: goalRaceName || null,
          goal_race_date: goalRaceDate || null,
          goal_distance: goalDistance || null,
          goal_notes: goalNotes || null,
          is_coach: isCoach,
          personal_bests: bests.filter((b) => b.timeSec > 0),
        })
        .eq("id", athlete.id);
      // Found live (Nov 2026, full codebase audit): this was never
      // checked — a failed write still showed "Saved" with no error.
      if (error) {
        console.error("Failed to save athlete profile", error);
        setSaveError(error.message);
      } else {
        setSaved(true);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  const predicted = predictRaceTimes(bests);

  return (
    <Card className="flex flex-col gap-5">
      <CardTitle>{athlete?.name ?? "…"} · {isEn ? "Athlete Profile" : "Perfil del Atleta"}</CardTitle>

      <form onSubmit={save} className="flex flex-col gap-6">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
            {isEn ? "Personal info" : "Información personal"}
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={isEn ? "Birth date" : "Fecha de nacimiento"}>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={isEn ? "Sex" : "Sexo"}>
              <select value={sex} onChange={(e) => setSex(e.target.value as typeof sex)} className={inputCls}>
                <option value="">-</option>
                <option value="male">{isEn ? "Male" : "Masculino"}</option>
                <option value="female">{isEn ? "Female" : "Femenino"}</option>
                <option value="other">{isEn ? "Other" : "Otro"}</option>
              </select>
            </Field>
            <Field label={isEn ? "Height (cm)" : "Estatura (cm)"}>
              <input type="number" min={0} max={250} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className={inputCls} />
            </Field>
            <Field label={isEn ? "Weight (kg)" : "Peso (kg)"}>
              <input type="number" min={0} max={300} step={0.1} value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className={inputCls} />
            </Field>
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
            {isEn ? "Role" : "Rol"}
          </h4>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3 text-sm">
            <input
              type="checkbox"
              checked={isCoach}
              onChange={(e) => setIsCoach(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              <span className="font-medium text-ink">{isEn ? "I'm a coach" : "Soy coach"}</span>
              <span className="block text-xs text-ink-3">
                {isEn
                  ? "Lets you create Communities on the Community tab and assign a workout to every member at once. Leave unchecked if you're just an athlete — you can still join any community."
                  : "Te deja crear Comunidades en la pestaña Community y asignar un entreno a todos los miembros a la vez. Déjalo sin marcar si solo eres atleta — igual puedes unirte a cualquier comunidad."}
              </span>
            </span>
          </label>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
            {isEn ? "Resting / max heart rate" : "Frecuencia cardíaca en reposo / máxima"}
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={isEn ? "Resting HR (bpm)" : "FC en reposo (bpm)"}>
              <input type="number" min={0} max={150} value={restingHr} onChange={(e) => setRestingHr(e.target.value)} className={inputCls} />
            </Field>
            <Field label={isEn ? "Max HR (bpm)" : "FC máxima (bpm)"}>
              <input type="number" min={0} max={250} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} className={inputCls} />
            </Field>
          </div>
        </section>

        {athlete && (athlete.threshold_hr || athlete.threshold_pace_sec_per_km || athlete.ftp_watts || athlete.strava_hr_zones) && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">{t("zones_h")}</h4>
            <p className="mb-2 text-xs text-ink-3">
              {isEn
                ? "Heart rate and pace zones computed from the thresholds set below in Training Zones."
                : "Zonas de frecuencia cardíaca y pace calculadas a partir de los umbrales de la tarjeta Zonas de Entrenamiento más abajo."}
            </p>
            <ZoneTables athlete={athlete} />
          </section>
        )}

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
            {isEn ? "Goal race" : "Carrera objetivo"}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label={isEn ? "Race name" : "Nombre de la carrera"}>
              <input value={goalRaceName} onChange={(e) => setGoalRaceName(e.target.value)} className={inputCls} />
            </Field>
            <Field label={isEn ? "Race date" : "Fecha de la carrera"}>
              <input type="date" value={goalRaceDate} onChange={(e) => setGoalRaceDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={isEn ? "Distance" : "Distancia"}>
              <input
                value={goalDistance}
                onChange={(e) => setGoalDistance(e.target.value)}
                placeholder={isEn ? "e.g. Half Ironman (70.3)" : "ej. Half Ironman (70.3)"}
                className={inputCls}
              />
            </Field>
            <Field label={isEn ? "Goal / target time" : "Objetivo / tiempo meta"}>
              <input value={goalNotes} onChange={(e) => setGoalNotes(e.target.value)} className={inputCls} />
            </Field>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
              {isEn ? "Personal bests" : "Mejores tiempos"}
            </h4>
            <Button type="button" variant="steel" size="sm" onClick={addBest}>
              + {isEn ? "Add" : "Agregar"}
            </Button>
          </div>
          {bests.length === 0 ? (
            <p className="text-sm text-ink-3">{isEn ? "No personal bests yet." : "Todavía no hay mejores tiempos."}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {bests.map((b) => (
                <PersonalBestRow key={b.id} best={b} onChange={(patch) => updateBest(b.id, patch)} onRemove={() => removeBest(b.id)} />
              ))}
            </div>
          )}
        </section>

        {predicted && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
              {isEn ? "Race predictor" : "Predictor de carrera"}
            </h4>
            <p className="mb-2 text-xs text-ink-3">
              {isEn
                ? "Estimated from your longest run personal best, using Riegel's formula."
                : "Estimado a partir de tu mejor tiempo de carrera más largo, usando la fórmula de Riegel."}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {predicted.map((p) => (
                <div key={p.key} className="rounded-xl border border-line bg-bg p-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{p.label}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                    {durationLabel(p.predictedSec)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {p.fromActual ? (isEn ? "actual" : "real") : isEn ? "estimated" : "estimado"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving || !athlete}>
            {t("save")}
          </Button>
          {saved && <span className="text-xs text-ink-3">{t("saved")}</span>}
          {saveError && <span className="text-xs text-error">{saveError}</span>}
        </div>
      </form>
    </Card>
  );
}

const inputCls = "h-10 rounded-xl border border-line bg-bg px-3 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-ink-2">{label}</label>
      {children}
    </div>
  );
}

function PersonalBestRow({
  best,
  onChange,
  onRemove,
}: {
  best: PersonalBest;
  onChange: (patch: Partial<PersonalBest>) => void;
  onRemove: () => void;
}) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const presets = DISTANCE_PRESETS[best.sport];
  const isCustom = !presets.some((p) => p.label === best.distanceLabel) || best.distanceLabel === "Custom";
  const h = Math.floor(best.timeSec / 3600);
  const m = Math.floor((best.timeSec % 3600) / 60);
  const s = Math.round(best.timeSec % 60);

  function setTime(hh: string, mm: string, ss: string) {
    onChange({ timeSec: parseDuration(hh, mm, ss) ?? 0 });
  }

  function onSportChange(sport: Sport) {
    const firstPreset = DISTANCE_PRESETS[sport][0];
    onChange({ sport, distanceLabel: firstPreset.label, distanceMeters: firstPreset.meters });
  }

  function onPresetChange(label: string) {
    const preset = presets.find((p) => p.label === label);
    onChange({ distanceLabel: label, distanceMeters: preset?.meters ?? null });
  }

  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
      <Field label={isEn ? "Sport" : "Deporte"}>
        <select value={best.sport} onChange={(e) => onSportChange(e.target.value as Sport)} className={inputCls}>
          {SPORTS.filter((s) => s !== "gym").map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label={isEn ? "Distance" : "Distancia"}>
        <select value={isCustom ? "Custom" : best.distanceLabel} onChange={(e) => onPresetChange(e.target.value)} className={inputCls}>
          {presets.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {isCustom && (
        <Field label={isEn ? "Custom label" : "Etiqueta personalizada"}>
          <input value={best.distanceLabel === "Custom" ? "" : best.distanceLabel} onChange={(e) => onChange({ distanceLabel: e.target.value || "Custom" })} className={inputCls} />
        </Field>
      )}
      <Field label={isEn ? "Time (H:M:S)" : "Tiempo (H:M:S)"}>
        {/* Found live (Nov 2026, full codebase audit): `value={m || ""}`
            hid a real 0 — a PB of exactly 1:00:00 showed blank minutes/
            seconds boxes instead of "0". Only the row-level "nothing
            entered yet" state (timeSec === 0 overall) should render
            blank; once any time is set, every field shows its real
            digit, zero included. */}
        <div className="flex items-center gap-1">
          <input type="number" min={0} placeholder="H" value={best.timeSec > 0 ? h : ""} onChange={(e) => setTime(e.target.value, String(m), String(s))} className={inputCls + " w-14"} />
          <span className="text-ink-3">:</span>
          <input type="number" min={0} max={59} placeholder="M" value={best.timeSec > 0 ? m : ""} onChange={(e) => setTime(String(h), e.target.value, String(s))} className={inputCls + " w-14"} />
          <span className="text-ink-3">:</span>
          <input type="number" min={0} max={59} placeholder="S" value={best.timeSec > 0 ? s : ""} onChange={(e) => setTime(String(h), String(m), e.target.value)} className={inputCls + " w-14"} />
        </div>
      </Field>
      <Field label={isEn ? "Date" : "Fecha"}>
        <input type="date" value={best.date} onChange={(e) => onChange({ date: e.target.value })} className={inputCls} />
      </Field>
      <Field label={isEn ? "Race (optional)" : "Carrera (opcional)"}>
        <div className="flex items-center gap-2">
          <input value={best.raceName} onChange={(e) => onChange({ raceName: e.target.value })} className={inputCls} />
          <Button type="button" variant="danger" size="sm" onClick={onRemove}>
            ×
          </Button>
        </div>
      </Field>
    </div>
  );
}
