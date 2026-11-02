"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { computeFitnessForm, type DailyLoad, type FitnessFormResult } from "@/lib/fitnessForm";

/**
 * Fitness (CTL) / Fatigue (ATL) / Form (TSB) — see CLAUDE.md's
 * "Fitness/Fatigue/Form" note and lib/fitnessForm.ts for the formula and
 * why this was deferred until there was more than 30 days of history.
 * Reads `strava_daily_load` directly (RLS open to anon while auth is off,
 * same as every other table this app reads client-side) rather than
 * computing server-side, since the model itself is cheap and this keeps
 * the panel self-contained like ZoneTables/StravaTotals next to it.
 */
export function FitnessPanel({ athleteId }: { athleteId: string }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [result, setResult] = useState<FitnessFormResult | null | "loading">("loading");

  const load = useCallback(async () => {
    setResult("loading");
    const supabase = createClient();
    const { data } = await supabase
      .from("strava_daily_load")
      .select("date, relative_effort")
      .eq("athlete_id", athleteId)
      .order("date", { ascending: true });
    const loads: DailyLoad[] = (data ?? []).map((r) => ({ date: r.date as string, stress: Number(r.relative_effort) }));
    setResult(computeFitnessForm(loads));
  }, [athleteId]);

  useEffect(() => {
    // Refetch whenever the selected athlete changes — not just on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (result === "loading") return null;

  if (!result) {
    return (
      <Card>
        <h3 className="text-lg font-semibold tracking-tight">{isEn ? "Fitness / Fatigue / Form" : "Forma Física / Fatiga / Forma"}</h3>
        <p className="mt-2 text-sm text-ink-3">
          {isEn
            ? "No training-load history synced yet. Sync Strava to start building this up."
            : "Todavía no hay historial de carga de entrenamiento sincronizado. Sincroniza Strava para empezar a acumularlo."}
        </p>
      </Card>
    );
  }

  const { current, series, daysOfHistory, warmedUp } = result;
  const recent = series.slice(-56); // last 8 weeks, for the sparkline

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">{isEn ? "Fitness / Fatigue / Form" : "Forma Física / Fatiga / Forma"}</h3>
        <span className="text-[11px] text-ink-3">
          {isEn ? "estimated · from Relative Effort" : "estimado · a partir del Esfuerzo Relativo"}
        </span>
      </div>

      {!warmedUp && (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
          {isEn
            ? `Still warming up, only ${daysOfHistory} day(s) of history so far. Fitness (CTL) needs ~42 days to settle; these numbers will understate it until then.`
            : `Todavía calentando, solo ${daysOfHistory} día(s) de historial hasta ahora. La Forma Física (CTL) necesita ~42 días para estabilizarse; estos números la subestiman hasta entonces.`}
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label={isEn ? "Fitness (CTL)" : "Forma Física (CTL)"} value={current.ctl} />
        <Stat label={isEn ? "Fatigue (ATL)" : "Fatiga (ATL)"} value={current.atl} />
        <Stat label={isEn ? "Form (TSB)" : "Forma (TSB)"} value={current.tsb} signed />
      </div>

      <div className="mt-4">
        <FitnessChart points={recent} />
      </div>
    </Card>
  );
}

function Stat({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const rounded = Math.round(value * 10) / 10;
  const text = signed && rounded > 0 ? `+${rounded}` : String(rounded);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {text}
      </p>
    </div>
  );
}

function FitnessChart({ points }: { points: { date: string; ctl: number; atl: number; tsb: number }[] }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 140;
  const pad = 8;
  const allVals = points.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  const min = Math.min(0, ...allVals);
  const max = Math.max(1, ...allVals);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  function pathFor(key: "ctl" | "atl" | "tsb") {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="fitness form chart">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
      <path d={pathFor("tsb")} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="3,3" />
      <path d={pathFor("atl")} fill="none" stroke="var(--error)" strokeWidth={1.5} opacity={0.7} />
      <path d={pathFor("ctl")} fill="none" stroke="var(--ink)" strokeWidth={2} />
    </svg>
  );
}
