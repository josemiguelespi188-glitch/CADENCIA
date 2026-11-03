"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { hm } from "@/lib/dates";
import type { Athlete, WhoopCycle, WhoopRecovery, WhoopSleep } from "@/lib/types";

interface WhoopData {
  connected: boolean;
  cycles: WhoopCycle[]; // newest first
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
}

/**
 * WHOOP's own headline metrics — Strain and Recovery — plus HRV, sleep
 * performance, resting HR, SpO2, and skin temperature. Unlike
 * GarminHealthPanel, every field name here is copied directly from the
 * real WHOOP OpenAPI spec pasted into this session, not reconstructed —
 * see lib/integrations/whoop.ts's file header. Same design language as
 * GarminHealthPanel (hero row + sparkline, no fabricated verdicts) for
 * consistency across the two wearable integrations.
 */
export function WhoopPanel({ athlete }: { athlete: Athlete }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [data, setData] = useState<WhoopData | "loading">("loading");

  const load = useCallback(async () => {
    setData("loading");
    const supabase = createClient();
    const [conn, cycles, recoveries, sleeps] = await Promise.all([
      supabase.from("whoop_connections").select("athlete_id").eq("athlete_id", athlete.id).maybeSingle(),
      supabase.from("whoop_cycles").select("*").eq("athlete_id", athlete.id).order("start_at", { ascending: false }).limit(14),
      supabase.from("whoop_recovery").select("*").eq("athlete_id", athlete.id).order("whoop_cycle_id", { ascending: false }).limit(14),
      supabase.from("whoop_sleep").select("*").eq("athlete_id", athlete.id).order("start_at", { ascending: false }).limit(14),
    ]);
    setData({
      connected: !!conn.data,
      cycles: cycles.data ?? [],
      recoveries: recoveries.data ?? [],
      sleeps: sleeps.data ?? [],
    });
  }, [athlete.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (data === "loading") return null;

  const latestCycle = data.cycles[0] ?? null;
  const latestRecovery = data.recoveries[0] ?? null;
  const latestSleep = data.sleeps.find((s) => !s.nap) ?? data.sleeps[0] ?? null;
  const hasAnything = !!(latestCycle || latestRecovery || latestSleep);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">WHOOP</h3>
        <span className="text-[11px] text-ink-3">{isEn ? "from WHOOP" : "de WHOOP"}</span>
      </div>

      {!hasAnything ? (
        <p className="mt-3 text-sm text-ink-3">
          {data.connected
            ? isEn
              ? "Connected, but no data synced yet. Click “Sync now” on the WHOOP card in Settings."
              : "Conectado, pero todavía no hay datos sincronizados. Haz clic en “Sincronizar ahora” en la tarjeta de WHOOP en Ajustes."
            : isEn
              ? "Connect WHOOP from Settings to see strain, recovery, HRV, and sleep here."
              : "Conecta WHOOP desde Ajustes para ver aquí strain, recuperación, HRV y sueño."}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <MiniStat
            label={isEn ? "Strain" : "Strain"}
            value={latestCycle?.strain != null ? latestCycle.strain.toFixed(1) : "–"}
            sub="0-21"
          />
          <MiniStat
            label={isEn ? "Recovery" : "Recuperación"}
            value={latestRecovery?.recovery_score != null ? `${Math.round(latestRecovery.recovery_score)}%` : "–"}
          />
          <MiniStat
            label="HRV"
            value={latestRecovery?.hrv_rmssd_milli != null ? `${Math.round(latestRecovery.hrv_rmssd_milli)}` : "–"}
            sub="ms"
          />
          <MiniStat
            label={isEn ? "Sleep performance" : "Rendimiento de sueño"}
            value={latestSleep?.sleep_performance_pct != null ? `${Math.round(latestSleep.sleep_performance_pct)}%` : "–"}
            sub={latestSleep?.total_in_bed_ms != null ? hm(latestSleep.total_in_bed_ms / 60000, isEn ? "en" : "es") : undefined}
          />
          <MiniStat
            label={isEn ? "Resting HR" : "FC en reposo"}
            value={latestRecovery?.resting_heart_rate != null ? `${Math.round(latestRecovery.resting_heart_rate)}` : "–"}
            sub="bpm"
          />
          <MiniStat
            label="SpO2"
            value={latestRecovery?.spo2_percentage != null ? `${latestRecovery.spo2_percentage.toFixed(1)}%` : "–"}
          />
          <MiniStat
            label={isEn ? "Skin temp" : "Temp. de piel"}
            value={latestRecovery?.skin_temp_celsius != null ? `${latestRecovery.skin_temp_celsius.toFixed(1)}°C` : "–"}
          />
          <MiniStat
            label={isEn ? "Respiration" : "Respiración"}
            value={latestSleep?.respiratory_rate != null ? latestSleep.respiratory_rate.toFixed(1) : "–"}
            sub={isEn ? "breaths/min" : "resp./min"}
          />
        </div>
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
