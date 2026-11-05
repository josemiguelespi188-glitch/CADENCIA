"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { computeFitnessForm, type FitnessFormPoint } from "@/lib/fitnessForm";
import type { Athlete } from "@/lib/types";

const PALETTE = ["--swim", "--bike", "--run", "--gym", "--brick"];

interface MemberSeries {
  athleteId: string;
  points: FitnessFormPoint[];
}

/**
 * Per-member Fitness (CTL) progress, plotted across a community's own
 * training block — the "gráfico xy donde se va moviendo el usuario según
 * su entrenamiento y carga" from the user's direct request (Nov 2026,
 * see CLAUDE.md's "Community event countdown" section). Confirmed via
 * AskUserQuestion: CTL (reusing the exact same Banister model
 * `FitnessPanel.tsx` already plots solo, see lib/fitnessForm.ts) is the
 * metric, read from `whoop_cycles.strain` — this project's own
 * already-established data source for this model, switched off Strava's
 * Relative Effort project-wide (see CLAUDE.md's "Fitness/Fatigue/Form
 * switched to WHOOP Strain" section) — not the stale, no-longer-read
 * `strava_daily_load` table.
 *
 * CTL itself is computed from EACH member's full available WHOOP
 * history (so the 42-day ramp-up is real, not reset at the training
 * block's own start), then the displayed series is sliced to `dateRange`
 * — showing genuine progress across the training block without
 * understating day-one fitness as if training started from zero.
 */
export function CommunityFitnessChart({
  members,
  dateRange,
}: {
  members: Athlete[];
  dateRange: { from: string; to: string };
}) {
  const [series, setSeries] = useState<MemberSeries[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSeries(null);
      if (!members.length) {
        setSeries([]);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("whoop_cycles")
        .select("athlete_id, start_at, strain")
        .in("athlete_id", members.map((m) => m.id));
      if (cancelled) return;

      const byAthlete = new Map<string, Map<string, number>>();
      for (const r of data ?? []) {
        if (r.strain === null) continue;
        const date = (r.start_at as string).slice(0, 10);
        const m = byAthlete.get(r.athlete_id) ?? new Map<string, number>();
        m.set(date, (m.get(date) ?? 0) + Number(r.strain));
        byAthlete.set(r.athlete_id, m);
      }

      const result: MemberSeries[] = [];
      for (const member of members) {
        const loads = Array.from(byAthlete.get(member.id)?.entries() ?? [])
          .map(([date, stress]) => ({ date, stress }))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        const fitness = computeFitnessForm(loads);
        if (!fitness) continue;
        const points = fitness.series.filter((p) => p.date >= dateRange.from && p.date <= dateRange.to);
        if (points.length) result.push({ athleteId: member.id, points });
      }
      setSeries(result);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [members, dateRange.from, dateRange.to]);

  if (series === null) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm uppercase tracking-widest text-ink-3">Fitness (CTL) progress</h3>
        <span className="text-[11px] text-ink-3">estimated · from WHOOP Strain</span>
      </div>

      {series.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">No WHOOP Strain history synced yet for this community&apos;s members.</p>
      ) : (
        <>
          <div className="mt-4">
            <CtlChart series={series} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {series.map((s, i) => {
              const athlete = members.find((m) => m.id === s.athleteId);
              const color = `var(${PALETTE[i % PALETTE.length]})`;
              return (
                <span key={s.athleteId} className="flex items-center gap-1.5 text-xs text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {athlete?.name ?? "?"}
                </span>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function CtlChart({ series }: { series: MemberSeries[] }) {
  const W = 640;
  const H = 180;
  const pad = 8;
  const allDates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  if (allDates.length < 2) return null;
  const dateIndex = new Map(allDates.map((d, i) => [d, i]));
  const allCtl = series.flatMap((s) => s.points.map((p) => p.ctl));
  const min = Math.min(0, ...allCtl);
  const max = Math.max(1, ...allCtl);
  const x = (i: number) => pad + (i / (allDates.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="community fitness progress chart">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
      {series.map((s, i) => {
        const color = `var(${PALETTE[i % PALETTE.length]})`;
        const path = s.points.map((p, j) => `${j === 0 ? "M" : "L"}${x(dateIndex.get(p.date)!).toFixed(1)},${y(p.ctl).toFixed(1)}`).join(" ");
        return <path key={s.athleteId} d={path} fill="none" stroke={color} strokeWidth={2} />;
      })}
    </svg>
  );
}
