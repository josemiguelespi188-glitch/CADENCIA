"use client";

import { useLocale } from "@/lib/i18n/context";
import { Card, CardTitle } from "@/components/ui/card";
import type { ActivityWithSlug, Athlete } from "@/lib/types";
import { SPORTS } from "@/lib/types";
import { buildCompareAxes } from "@/lib/compareMetrics";
import { predictRaceTimes } from "@/lib/racePredictor";
import { computeFitnessForm, type DailyLoad } from "@/lib/fitnessForm";
import { durationLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

// Fixed pair of pastel sport-accent colors reused as "athlete A / athlete
// B" throughout this whole view (radar polygons, zone bars, the fitness
// sparkline) — not tied to either athlete's own sport mix, just a
// consistent, already-in-palette warm/cool pair so every chart on this
// page reads as the same two people without inventing new brand colors.
const COLOR_A = "var(--bike)";
const COLOR_B = "var(--gym)";
const SOFT_A = "var(--bike-soft)";
const SOFT_B = "var(--gym-soft)";

const SPORT_COLORS: Record<string, string> = {
  swim: "var(--swim)",
  bike: "var(--bike)",
  run: "var(--run)",
  gym: "var(--gym)",
  race: "var(--race)",
  brick: "var(--brick)",
  other: "var(--ink-3)",
};

/**
 * Community Phase 2 — "comparar nuestros dos perfiles," súper dinámico,
 * súper colorido, per the user's own explicit ask (see CLAUDE.md's
 * "Community" section). Every number here is either real (zones,
 * personal bests, Strava/WHOOP data already synced) or a clearly-labeled
 * published-formula projection (Riegel's 5K/10K/Half/Marathon, the same
 * one /settings already shows) — nothing invented for the sake of
 * filling a chart.
 */
export function CompareProfiles({
  a,
  b,
  activitiesA,
  activitiesB,
  whoopLoadsA,
  whoopLoadsB,
}: {
  a: Athlete;
  b: Athlete;
  activitiesA: ActivityWithSlug[];
  activitiesB: ActivityWithSlug[];
  whoopLoadsA: DailyLoad[];
  whoopLoadsB: DailyLoad[];
}) {
  const { locale } = useLocale();
  const isEn = locale === "en";

  const axes = buildCompareAxes(a, b, activitiesA, activitiesB);
  const predA = predictRaceTimes(a.personal_bests);
  const predB = predictRaceTimes(b.personal_bests);
  const fitnessA = whoopLoadsA.length ? computeFitnessForm(whoopLoadsA) : null;
  const fitnessB = whoopLoadsB.length ? computeFitnessForm(whoopLoadsB) : null;

  const sportTotals = SPORTS.filter((s) => s !== "race").map((sport) => {
    const sumFor = (acts: ActivityWithSlug[], athleteId: string) =>
      acts
        .filter((x) => x.athlete_id === athleteId && mapsTo(x.sport_type) === sport)
        .reduce((acc, x) => acc + (x.distance_m ?? 0), 0);
    return { sport, distA: sumFor(activitiesA, a.id), distB: sumFor(activitiesB, b.id) };
  });
  const hasSportData = sportTotals.some((s) => s.distA > 0 || s.distB > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-center justify-center gap-6 py-8 sm:gap-12">
        <AthleteBadge athlete={a} color={COLOR_A} />
        <span className="text-xl font-black uppercase tracking-widest text-ink-3">VS</span>
        <AthleteBadge athlete={b} color={COLOR_B} />
      </Card>

      {axes.length >= 3 && (
        <Card>
          <CardTitle>{isEn ? "Head to head" : "Cara a cara"}</CardTitle>
          <p className="mt-1 text-xs text-ink-3">
            {isEn
              ? "Each axis is scaled to whichever of you is ahead on it — outward always means better."
              : "Cada eje se escala contra quien va mejor en él — más afuera siempre es mejor."}
          </p>
          <div className="mt-4">
            <RadarChart axes={axes} colorA={COLOR_A} colorB={COLOR_B} />
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-ink-3">
            {axes.map((ax) => (
              <span key={ax.key}>
                {ax.label}: <span style={{ color: COLOR_A }}>{fmtNum(ax.a)}</span> vs <span style={{ color: COLOR_B }}>{fmtNum(ax.b)}</span> {ax.unit}
              </span>
            ))}
          </div>
        </Card>
      )}

      {hasSportData && (
        <Card>
          <CardTitle>{isEn ? "Last 30 days by sport" : "Últimos 30 días por deporte"}</CardTitle>
          <div className="mt-4 flex flex-col gap-3">
            {sportTotals
              .filter((s) => s.distA > 0 || s.distB > 0)
              .map((s) => (
                <DivergingBar key={s.sport} sport={s.sport} label={isEn ? sportLabelEn(s.sport) : sportLabelEs(s.sport)} distA={s.distA} distB={s.distB} />
              ))}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>{isEn ? "Thresholds & zones" : "Umbrales y zonas"}</CardTitle>
        <div className="mt-4 flex flex-col gap-4">
          <ThresholdBar label="LTHR" unit="bpm" a={a.threshold_hr} b={b.threshold_hr} />
          <ThresholdBar label={isEn ? "Threshold pace" : "Pace umbral"} unit="sec/km" a={a.threshold_pace_sec_per_km} b={b.threshold_pace_sec_per_km} lowerIsBetter />
          <ThresholdBar label="FTP" unit="W" a={a.ftp_watts} b={b.ftp_watts} />
          <ThresholdBar label="VO2max" unit="ml/kg/min" a={a.garmin_vo2max ?? a.vo2max} b={b.garmin_vo2max ?? b.vo2max} />
        </div>
      </Card>

      {(predA || predB) && (
        <Card className="overflow-x-auto">
          <CardTitle>{isEn ? "Race predictor" : "Predictor de carrera"}</CardTitle>
          <p className="mt-1 text-xs text-ink-3">
            {isEn ? "Estimated via Riegel's formula unless marked actual." : "Estimado con la fórmula de Riegel salvo que diga actual."}
          </p>
          <table className="mt-3 w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-ink-3">
                <th className="py-1.5 font-semibold"> </th>
                <th className="py-1.5 font-semibold" style={{ color: COLOR_A }}>
                  {a.name}
                </th>
                <th className="py-1.5 font-semibold" style={{ color: COLOR_B }}>
                  {b.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {(predA ?? predB ?? []).map((row) => {
                const pa = predA?.find((p) => p.key === row.key);
                const pb = predB?.find((p) => p.key === row.key);
                return (
                  <tr key={row.key} className="border-t border-line">
                    <td className="py-1.5 font-medium">{row.label}</td>
                    <td className="py-1.5 tabular-nums text-ink-2">
                      {pa ? `${durationLabel(pa.predictedSec)}${pa.fromActual ? ` (${isEn ? "actual" : "real"})` : ""}` : "–"}
                    </td>
                    <td className="py-1.5 tabular-nums text-ink-2">
                      {pb ? `${durationLabel(pb.predictedSec)}${pb.fromActual ? ` (${isEn ? "actual" : "real"})` : ""}` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {(fitnessA || fitnessB) && (
        <Card>
          <CardTitle>{isEn ? "Fitness / Fatigue / Form" : "Forma Física / Fatiga / Forma"}</CardTitle>
          <p className="mt-1 text-xs text-ink-3">{isEn ? "estimated · from WHOOP Strain" : "estimado · a partir del Strain de WHOOP"}</p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <FitnessMini name={a.name} color={COLOR_A} result={fitnessA} isEn={isEn} />
            <FitnessMini name={b.name} color={COLOR_B} result={fitnessB} isEn={isEn} />
          </div>
        </Card>
      )}
    </div>
  );
}

function mapsTo(sportType: string): string | null {
  const s = sportType.toLowerCase();
  if (s.includes("swim")) return "swim";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "bike";
  if (s.includes("run")) return "run";
  if (s.includes("weight") || s.includes("workout") || s.includes("training")) return "gym";
  return null;
}

function sportLabelEn(s: string) {
  return { swim: "Swim", bike: "Bike", run: "Run", gym: "Gym", brick: "Bike + Run" }[s] ?? s;
}
function sportLabelEs(s: string) {
  return { swim: "Natación", bike: "Bici", run: "Trote", gym: "Gimnasio", brick: "Bici + Trote" }[s] ?? s;
}

function fmtNum(n: number) {
  return Math.round(n * 10) / 10;
}

function AthleteBadge({ athlete, color }: { athlete: Athlete; color: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-ink"
        style={{ background: color, opacity: 0.85 }}
      >
        {athlete.initials}
      </span>
      <p className="text-sm font-semibold">{athlete.name}</p>
    </div>
  );
}

function RadarChart({ axes, colorA, colorB }: { axes: { label: string; a: number; b: number }[]; colorA: string; colorB: string }) {
  const W = 320;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2;
  const R = 120;
  const n = axes.length;

  const pt = (i: number, frac: number) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(angle) * R * frac, cy + Math.sin(angle) * R * frac] as const;
  };

  function polygon(values: number[]) {
    return values
      .map((v, i) => {
        const [x, y] = pt(i, Math.max(0, Math.min(1, v)));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  // Each axis normalizes independently against its own two values, so the
  // bigger one always reaches the outer ring — this chart answers "who's
  // ahead on each axis," not "how do these compare to some absolute max."
  const fracsA = axes.map((ax) => (ax.a <= 0 && ax.b <= 0 ? 0 : ax.a / Math.max(ax.a, ax.b, 1e-6)));
  const fracsB = axes.map((ax) => (ax.a <= 0 && ax.b <= 0 ? 0 : ax.b / Math.max(ax.a, ax.b, 1e-6)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-xs" role="img" aria-label="comparison radar">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={Array.from({ length: n }, (_, i) => pt(i, ring).join(",")).join(" ")}
          fill="none"
          stroke="var(--line)"
          strokeWidth={1}
        />
      ))}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.18);
        return (
          <text key={ax.label} x={x} y={y} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
            {ax.label}
          </text>
        );
      })}
      <polygon points={polygon(fracsA)} fill={colorA} fillOpacity={0.3} stroke={colorA} strokeWidth={2} />
      <polygon points={polygon(fracsB)} fill={colorB} fillOpacity={0.3} stroke={colorB} strokeWidth={2} />
    </svg>
  );
}

function DivergingBar({ sport, label, distA, distB }: { sport: string; label: string; distA: number; distB: number }) {
  const max = Math.max(distA, distB, 1);
  const pctA = (distA / max) * 100;
  const pctB = (distB / max) * 100;
  return (
    <div className="grid grid-cols-[1fr_90px_1fr] items-center gap-2 text-sm">
      <div className="flex items-center justify-end gap-2">
        <span className="tabular-nums text-xs text-ink-3">{(distA / 1000).toFixed(1)} km</span>
        <div className="h-2.5 w-full max-w-[160px] overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className="ml-auto h-full rounded-full" style={{ width: `${pctA}%`, background: COLOR_A }} />
        </div>
      </div>
      <span className={cn("s-" + sport, "flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide")} style={{ color: SPORT_COLORS[sport] }}>
        <span className="h-2 w-2 rounded-full" style={{ background: SPORT_COLORS[sport] }} />
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-full max-w-[160px] overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className="h-full rounded-full" style={{ width: `${pctB}%`, background: COLOR_B }} />
        </div>
        <span className="tabular-nums text-xs text-ink-3">{(distB / 1000).toFixed(1)} km</span>
      </div>
    </div>
  );
}

function ThresholdBar({ label, unit, a, b, lowerIsBetter }: { label: string; unit: string; a: number | null; b: number | null; lowerIsBetter?: boolean }) {
  if (a === null && b === null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-3">N/A</span>
      </div>
    );
  }
  const max = Math.max(a ?? 0, b ?? 0, 1);
  const pctA = a !== null ? (a / max) * 100 : 0;
  const pctB = b !== null ? (b / max) * 100 : 0;
  const better = a !== null && b !== null ? (lowerIsBetter ? (a < b ? "a" : b < a ? "b" : null) : a > b ? "a" : b > a ? "b" : null) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-ink-3">{unit}</span>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full" style={{ width: `${pctA}%`, background: SOFT_A, boxShadow: better === "a" ? `inset 0 0 0 1.5px ${COLOR_A}` : undefined }} />
          </div>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums" style={{ color: COLOR_A, fontWeight: better === "a" ? 700 : 400 }}>
            {a ?? "–"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs tabular-nums" style={{ color: COLOR_B, fontWeight: better === "b" ? 700 : 400 }}>
            {b ?? "–"}
          </span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full" style={{ width: `${pctB}%`, background: SOFT_B, boxShadow: better === "b" ? `inset 0 0 0 1.5px ${COLOR_B}` : undefined }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FitnessMini({ name, color, result, isEn }: { name: string; color: string; result: ReturnType<typeof computeFitnessForm>; isEn: boolean }) {
  if (!result) {
    return (
      <div>
        <p className="text-sm font-semibold">{name}</p>
        <p className="mt-2 text-xs text-ink-3">{isEn ? "No WHOOP history synced." : "Sin historial de WHOOP sincronizado."}</p>
      </div>
    );
  }
  const { current, series } = result;
  const recent = series.slice(-56);
  return (
    <div>
      <p className="text-sm font-semibold" style={{ color }}>
        {name}
      </p>
      <div className="mt-1 flex gap-4 text-xs text-ink-3">
        <span>
          CTL <b className="text-ink">{fmtNum(current.ctl)}</b>
        </span>
        <span>
          ATL <b className="text-ink">{fmtNum(current.atl)}</b>
        </span>
        <span>
          TSB <b className="text-ink">{fmtNum(current.tsb)}</b>
        </span>
      </div>
      <MiniCtlChart points={recent} color={color} />
    </div>
  );
}

function MiniCtlChart({ points, color }: { points: { ctl: number }[]; color: string }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 70;
  const pad = 4;
  const max = Math.max(1, ...points.map((p) => p.ctl));
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ctl).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="fitness trend">
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}
