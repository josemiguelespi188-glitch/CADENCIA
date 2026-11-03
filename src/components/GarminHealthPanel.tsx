"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { hm } from "@/lib/dates";
import type { Athlete, GarminBodyComp, GarminDailyHealth, GarminHrv, GarminHydration, GarminPulseOx, GarminRespiration, GarminSleep } from "@/lib/types";

interface HealthData {
  connected: boolean;
  daily: GarminDailyHealth[]; // newest first
  sleep: GarminSleep[];
  hrv: GarminHrv[];
  pulseOx: GarminPulseOx | null;
  respiration: GarminRespiration | null;
  bodyComp: GarminBodyComp | null;
  hydration: GarminHydration | null;
}

/**
 * Every Garmin Health API metric this app has access to (Nov 2026,
 * built per explicit instruction — "con todas... mejora ese
 * dashboard"), reading the tables migration 029 + garminHealthParse.ts
 * populate. See that file's own header for how confident each field is.
 *
 * **Deliberately no fabricated "is this good?" verdicts** for anything
 * where Garmin itself has no public standard scale — HRV, SpO2, and
 * respiration are shown as plain numbers with a trend line, never a
 * judgment, since HRV especially is highly individual and this app has
 * no baseline to compare against. Sleep Score and Stress DO get a
 * light band treatment, using Garmin's own publicly documented 0-100
 * scales (not invented here) — labeled as such.
 */
export function GarminHealthPanel({ athlete }: { athlete: Athlete }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [data, setData] = useState<HealthData | "loading">("loading");

  const load = useCallback(async () => {
    setData("loading");
    const supabase = createClient();
    const [conn, daily, sleep, hrv, pulseOx, respiration, bodyComp, hydration] = await Promise.all([
      supabase.from("garmin_dev_connections").select("athlete_id").eq("athlete_id", athlete.id).maybeSingle(),
      supabase.from("garmin_daily_health").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(14),
      supabase.from("garmin_sleep").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(14),
      supabase.from("garmin_hrv").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(14),
      supabase.from("garmin_pulse_ox").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("garmin_respiration").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("garmin_body_comp").select("*").eq("athlete_id", athlete.id).order("measured_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("garmin_hydration").select("*").eq("athlete_id", athlete.id).order("calendar_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setData({
      connected: !!conn.data,
      daily: daily.data ?? [],
      sleep: sleep.data ?? [],
      hrv: hrv.data ?? [],
      pulseOx: pulseOx.data ?? null,
      respiration: respiration.data ?? null,
      bodyComp: bodyComp.data ?? null,
      hydration: hydration.data ?? null,
    });
  }, [athlete.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (data === "loading") return null;

  const latestDaily = data.daily[0] ?? null;
  const latestSleep = data.sleep[0] ?? null;
  const latestHrv = data.hrv[0] ?? null;
  const hasVo2 = athlete.garmin_vo2max !== null || athlete.garmin_fitness_age !== null;
  const hasAnything = !!(latestDaily || latestSleep || latestHrv || data.pulseOx || data.respiration || data.bodyComp || data.hydration || hasVo2);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">{isEn ? "Recovery & Health" : "Recuperación y Salud"}</h3>
        <span className="text-[11px] text-ink-3">{isEn ? "from Garmin" : "de Garmin"}</span>
      </div>

      {!hasAnything ? (
        <p className="mt-3 text-sm text-ink-3">
          {data.connected
            ? isEn
              ? "Connected, but no Garmin health data has synced yet. It will appear here automatically after your device's next sync."
              : "Conectado, pero todavía no ha sincronizado datos de salud de Garmin. Aparecerán aquí automáticamente después de la próxima sincronización de tu dispositivo."
            : isEn
              ? "Connect Garmin (Developer API) from Settings to see sleep, HRV, Body Battery, stress, and more here."
              : "Conecta Garmin (Developer API) desde Ajustes para ver aquí sueño, HRV, Body Battery, estrés y más."}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <SleepTile sleep={latestSleep} history={data.sleep} isEn={isEn} />
            <HrvTile hrv={latestHrv} history={data.hrv} isEn={isEn} />
            <BodyBatteryTile daily={latestDaily} isEn={isEn} />
            <StressTile daily={latestDaily} history={data.daily} isEn={isEn} />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat
              label={isEn ? "SpO2" : "SpO2"}
              value={data.pulseOx?.avg_spo2 != null ? `${Math.round(data.pulseOx.avg_spo2)}%` : "–"}
              sub={data.pulseOx?.min_spo2 != null ? `${isEn ? "low" : "mín."} ${Math.round(data.pulseOx.min_spo2)}%` : undefined}
            />
            <MiniStat
              label={isEn ? "Respiration" : "Respiración"}
              value={data.respiration?.avg_breaths_per_min != null ? `${Math.round(data.respiration.avg_breaths_per_min)}` : "–"}
              sub={isEn ? "breaths/min" : "resp./min"}
            />
            <MiniStat
              label={isEn ? "Hydration" : "Hidratación"}
              value={data.hydration?.fluid_intake_ml != null ? `${(data.hydration.fluid_intake_ml / 1000).toFixed(1)} L` : "–"}
            />
            <MiniStat
              label={isEn ? "VO2max (device)" : "VO2max (dispositivo)"}
              value={athlete.garmin_vo2max != null ? `${Math.round(athlete.garmin_vo2max)}` : "–"}
              sub="ml/kg/min"
            />
            <MiniStat
              label={isEn ? "Fitness age" : "Edad física"}
              value={athlete.garmin_fitness_age != null ? `${athlete.garmin_fitness_age}` : "–"}
            />
          </div>

          {data.bodyComp && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">
                {isEn ? "Body composition" : "Composición corporal"} ·{" "}
                {new Date(data.bodyComp.measured_at).toLocaleDateString(locale)}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <MiniStat label={isEn ? "Weight" : "Peso"} value={data.bodyComp.weight_kg != null ? `${data.bodyComp.weight_kg.toFixed(1)} kg` : "–"} />
                <MiniStat label={isEn ? "Body fat" : "Grasa corporal"} value={data.bodyComp.body_fat_pct != null ? `${data.bodyComp.body_fat_pct.toFixed(1)}%` : "–"} />
                <MiniStat label={isEn ? "Body water" : "Agua corporal"} value={data.bodyComp.body_water_pct != null ? `${data.bodyComp.body_water_pct.toFixed(1)}%` : "–"} />
                <MiniStat label={isEn ? "Muscle mass" : "Masa muscular"} value={data.bodyComp.muscle_mass_kg != null ? `${data.bodyComp.muscle_mass_kg.toFixed(1)} kg` : "–"} />
                <MiniStat label="BMI" value={data.bodyComp.bmi != null ? data.bodyComp.bmi.toFixed(1) : "–"} />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

/** A tiny inline trend line — plain, no axis/labels, just shape. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} />
    </svg>
  );
}

/** Garmin's own publicly documented Sleep Score bands (not invented here). */
function sleepBand(score: number, isEn: boolean): { label: string; tone: "neutral" | "good" } {
  if (score >= 90) return { label: isEn ? "Excellent" : "Excelente", tone: "good" };
  if (score >= 80) return { label: isEn ? "Good" : "Bueno", tone: "neutral" };
  if (score >= 60) return { label: isEn ? "Fair" : "Regular", tone: "neutral" };
  return { label: isEn ? "Poor" : "Deficiente", tone: "neutral" };
}

function SleepTile({ sleep, history, isEn }: { sleep: GarminSleep | null; history: GarminSleep[]; isEn: boolean }) {
  const band = sleep?.overall_score != null ? sleepBand(sleep.overall_score, isEn) : null;
  const scores = [...history].reverse().map((s) => s.overall_score).filter((v): v is number => v != null);
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{isEn ? "Sleep score" : "Puntaje de sueño"}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
          {sleep?.overall_score ?? "–"}
        </span>
        {band && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={band.tone === "good" ? { background: "color-mix(in srgb, var(--success) 18%, transparent)", color: "var(--success)" } : { background: "var(--surface-2)", color: "var(--ink-2)" }}
          >
            {band.label}
          </span>
        )}
      </div>
      {sleep?.duration_s != null && <p className="mt-0.5 text-xs text-ink-3">{hm(sleep.duration_s / 60, isEn ? "en" : "es")}</p>}
      <Sparkline values={scores} />
    </div>
  );
}

function HrvTile({ hrv, history, isEn }: { hrv: GarminHrv | null; history: GarminHrv[]; isEn: boolean }) {
  const values = [...history].reverse().map((h) => h.last_night_avg).filter((v): v is number => v != null);
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">HRV</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
          {hrv?.last_night_avg ?? "–"}
        </span>
        <span className="text-xs text-ink-3">ms</span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">{isEn ? "last night avg" : "promedio anoche"}</p>
      <Sparkline values={values} />
    </div>
  );
}

function BodyBatteryTile({ daily, isEn }: { daily: GarminDailyHealth | null; isEn: boolean }) {
  const charged = daily?.body_battery_charged ?? null;
  const drained = daily?.body_battery_drained ?? null;
  const net = charged != null && drained != null ? charged - drained : null;
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">Body Battery</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
          {net !== null ? (net > 0 ? `+${net}` : net) : "–"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        {isEn ? "charged" : "cargada"} {charged ?? "–"} · {isEn ? "drained" : "drenada"} {drained ?? "–"}
      </p>
    </div>
  );
}

/** Garmin's own publicly documented Stress Score bands (not invented here). */
function stressBand(level: number, isEn: boolean): { label: string; tone: "neutral" | "alert" } {
  if (level >= 76) return { label: isEn ? "High" : "Alto", tone: "alert" };
  if (level >= 51) return { label: isEn ? "Medium" : "Medio", tone: "neutral" };
  if (level >= 26) return { label: isEn ? "Low" : "Bajo", tone: "neutral" };
  return { label: isEn ? "Rest" : "Descanso", tone: "neutral" };
}

function StressTile({ daily, history, isEn }: { daily: GarminDailyHealth | null; history: GarminDailyHealth[]; isEn: boolean }) {
  const band = daily?.average_stress_level != null ? stressBand(daily.average_stress_level, isEn) : null;
  const values = [...history].reverse().map((d) => d.average_stress_level).filter((v): v is number => v != null);
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{isEn ? "Stress" : "Estrés"}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
          {daily?.average_stress_level ?? "–"}
        </span>
        {band && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={band.tone === "alert" ? { background: "color-mix(in srgb, var(--error) 18%, transparent)", color: "var(--error)" } : { background: "var(--surface-2)", color: "var(--ink-2)" }}
          >
            {band.label}
          </span>
        )}
      </div>
      {daily?.max_stress_level != null && <p className="mt-0.5 text-xs text-ink-3">{isEn ? "max" : "máx."} {daily.max_stress_level}</p>}
      <Sparkline values={values} />
    </div>
  );
}
