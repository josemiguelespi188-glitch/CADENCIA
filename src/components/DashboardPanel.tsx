"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { StravaTotals } from "@/components/StravaTotals";
import { FitnessPanel } from "@/components/FitnessPanel";
import { GarminHealthPanel } from "@/components/GarminHealthPanel";
import { WhoopPanel } from "@/components/WhoopPanel";
import { ActivityDetailDialog } from "@/components/ActivityDetailDialog";
import type { WorkoutWithSlug } from "@/components/WorkoutDialog";
import { SPORTS, type ActivityWithSlug, type Athlete } from "@/lib/types";
import { addDays, dayDiff, fmt, hm, hrs, monday, paceLabel, parseYmd, today } from "@/lib/dates";
import { computeBestEfforts } from "@/lib/bestEfforts";
import { cn } from "@/lib/utils";

const RECENT_PAGE_SIZE = 5;

/**
 * The former /dashboard page's content — folded into the bottom of
 * /calendar per explicit instruction ("el panel me gustaría que esté
 * debajo del calendario... meterlo en la misma hoja"). Reuses whatever
 * workouts/activities/athletes the Calendar page already loaded (same
 * underlying queries this panel needs), so there's no second fetch here.
 */
export function DashboardPanel({
  viewing,
  athletes,
  workouts,
  activities,
}: {
  viewing: string[];
  athletes: Athlete[];
  workouts: WorkoutWithSlug[];
  activities: ActivityWithSlug[];
}) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const [openActivity, setOpenActivity] = useState<ActivityWithSlug | null>(null);
  const [recentPage, setRecentPage] = useState(0);

  const isMultiple = viewing.length > 1;
  const athleteBySlug = useMemo(() => Object.fromEntries(athletes.map((a) => [a.slug, a])), [athletes]);
  const visible = useMemo(() => workouts.filter((w) => viewing.includes(w.athleteSlug)), [workouts, viewing]);
  const visibleActivities = useMemo(() => activities.filter((a) => viewing.includes(a.athleteSlug)), [activities, viewing]);
  const soloAthlete = viewing.length === 1 ? (athletes.find((a) => a.slug === viewing[0]) ?? null) : null;
  const bestEfforts = useMemo(() => computeBestEfforts(visibleActivities), [visibleActivities]);

  const td = today();
  const weekStart = monday(td);
  const weekEnd = addDays(weekStart, 6);
  const thisWeek = visible.filter((w) => {
    const d = parseYmd(w.date);
    return d >= weekStart && d <= weekEnd;
  });
  const plannedMin = thisWeek.reduce((a, w) => a + w.minutes, 0);
  const doneMin = thisWeek.filter((w) => w.done).reduce((a, w) => a + w.minutes, 0);
  const doneCount = thisWeek.filter((w) => w.done).length;

  const nextRace = visible
    .filter((w) => w.sport === "race" && parseYmd(w.date) >= td)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const daysToRace = nextRace ? dayDiff(td, parseYmd(nextRace.date)) : null;

  const perSport = SPORTS.filter((s) => s !== "race").map((sport) => {
    const items = thisWeek.filter((w) => w.sport === sport);
    const p = items.reduce((a, w) => a + w.minutes, 0);
    const d = items.filter((w) => w.done).reduce((a, w) => a + w.minutes, 0);
    return { sport, p, d, count: items.length };
  });

  const upcoming = visible
    .filter((w) => {
      const d = parseYmd(w.date);
      return d >= td && d <= addDays(td, 6);
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const thresholdHr = soloAthlete?.threshold_hr ?? null;

  // Found live (Nov 2026, full codebase audit): activities arrives
  // sorted ascending by local_date (calendar/page.tsx's own fetch), so
  // slicing it directly for "Recent activities" showed the OLDEST
  // entries in the 30-day window first, not the newest — the opposite
  // of what the header/pagination implies. Sort a copy descending here
  // instead of relying on the caller's fetch order.
  const recentActivities = useMemo(
    () => [...visibleActivities].sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0)),
    [visibleActivities]
  );

  // Found live (Nov 2026, full codebase audit): recentPage never reset
  // when the athlete/Friends filter changed — switching to someone with
  // fewer synced activities while on page 2+ rendered an empty table
  // (recentSlice === [] while visibleActivities.length > 0) instead of
  // the empty state or a reset first page.
  useEffect(() => {
    // Resetting pagination to match a prop change — same accepted
    // pattern this codebase already uses elsewhere (e.g. WorkoutDialog's
    // own form-reset effect) for "local state must follow a prop."
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentPage(0);
  }, [viewing]);

  const recentStart = recentPage * RECENT_PAGE_SIZE;
  const recentSlice = recentActivities.slice(recentStart, recentStart + RECENT_PAGE_SIZE);
  const hasMoreRecent = recentActivities.length > recentStart + RECENT_PAGE_SIZE;

  return (
    <div className="mt-10 border-t border-line pt-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("nav_dashboard")}</h1>

      {soloAthlete && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm uppercase tracking-widest text-ink-3">{isEn ? "Performance Metrics" : "Métricas de Rendimiento"}</h2>
          <FitnessPanel athleteId={soloAthlete.id} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label={t("k_planned")} value={hm(plannedMin, locale as "es" | "en")} sub={t("this_week")} />
        <Kpi
          label={t("k_done")}
          value={hm(doneMin, locale as "es" | "en")}
          sub={`${plannedMin ? Math.round((doneMin / plannedMin) * 100) : 0}% ${t("of")} ${t("planned")}`}
        />
        <Kpi label={t("k_sessions")} value={`${doneCount} / ${thisWeek.length}`} sub={t("this_week")} />
        <Kpi
          label={t("k_race")}
          value={daysToRace !== null ? `${daysToRace} ${t("days")}` : "–"}
          sub={nextRace ? nextRace.title + (isMultiple ? ` · ${athleteBySlug[nextRace.athleteSlug]?.initials ?? "?"}` : "") : t("no_race")}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Card>
          <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("vol")}</h3>
          <VolumeChart workouts={visible} locale={locale} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("by_sport")}</h3>
            <div className="flex flex-col gap-3">
              {perSport.filter((x) => x.count).length ? (
                perSport
                  .filter((x) => x.count)
                  .map((x) => (
                    <div key={x.sport} className={cn("s-" + x.sport, "grid grid-cols-[72px_1fr_auto] items-center gap-2 text-sm")}>
                      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--c)" }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: "var(--c)" }} />
                        {t(x.sport)}
                      </span>
                      <div className="h-2.5 rounded-full" style={{ background: "var(--soft)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${x.p ? Math.round((x.d / x.p) * 100) : 0}%`, background: "var(--c)" }}
                        />
                      </div>
                      <span className="text-xs text-ink-3 tabular-nums">
                        {hm(x.d, locale as "es" | "en")} / {hm(x.p, locale as "es" | "en")}
                      </span>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-ink-3">{t("nothing")}</p>
              )}
            </div>
          </Card>
          <Card>
            <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("upcoming")}</h3>
            <div className="flex flex-col gap-2">
              {upcoming.length ? (
                upcoming.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-3">
                      {fmt(parseYmd(w.date), locale, { weekday: "short", day: "numeric" })}
                    </span>
                    <span className={cn("s-" + w.sport, "h-2 w-2 shrink-0 rounded-full")} style={{ background: "var(--c)" }} />
                    <span className={cn("truncate", w.done && "line-through opacity-60")}>{w.title}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink-3">{t("nothing")}</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {soloAthlete ? (
        <>
          <div className="mt-8">
            <GarminHealthPanel athlete={soloAthlete} />
          </div>
          <div className="mt-4">
            <WhoopPanel athlete={soloAthlete} />
          </div>
          <div className="mt-4">
            <StravaTotals athlete={soloAthlete} />
          </div>
        </>
      ) : (
        <p className="mt-8 text-sm text-ink-3">
          {isEn ? "Pick a single athlete above to see more stats." : "Elige un solo atleta arriba para ver más estadísticas."}
        </p>
      )}

      <h2 className="mt-8 mb-3 text-sm uppercase tracking-widest text-ink-3">
        {isEn ? "Best efforts (last 30 days)" : "Mejores esfuerzos (últimos 30 días)"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-4">
        {bestEfforts.map((e) => (
          <Card key={e.key} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{e.label}</p>
            {e.best ? (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                  {hm(e.best.moving_time_s / 60, locale as "es" | "en")}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {paceLabel(Math.round(e.best.moving_time_s / (e.best.distance_m / 1000)))} ·{" "}
                  {fmt(new Date(e.best.start_date), locale, { day: "numeric", month: "short" })}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-3">N/A</p>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-widest text-ink-3">{isEn ? "Recent activities" : "Actividades recientes"}</h2>
        {visibleActivities.length > RECENT_PAGE_SIZE && (
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <button
              onClick={() => setRecentPage((p) => Math.max(0, p - 1))}
              disabled={recentPage === 0}
              className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
            >
              {t("prev")}
            </button>
            <button
              onClick={() => setRecentPage((p) => p + 1)}
              disabled={!hasMoreRecent}
              className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        )}
      </div>
      {visibleActivities.length === 0 ? (
        <p className="text-sm text-ink-3">{isEn ? "No synced Strava activity yet." : "Todavía no hay actividad sincronizada de Strava."}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-widest text-ink-3">
                <th className="px-4 py-3 font-semibold">{isEn ? "Date" : "Fecha"}</th>
                {isMultiple && <th className="px-2 py-3 font-semibold">{t("athlete")}</th>}
                <th className="px-2 py-3 font-semibold">{isEn ? "Activity" : "Actividad"}</th>
                <th className="px-2 py-3 text-right font-semibold">{isEn ? "Duration" : "Duración"}</th>
                <th className="px-2 py-3 text-right font-semibold">{isEn ? "Distance" : "Distancia"}</th>
                <th className="px-2 py-3 text-right font-semibold">{isEn ? "Avg HR" : "FC prom."}</th>
                <th className="px-2 py-3 text-right font-semibold">{isEn ? "Cadence" : "Cadencia"}</th>
                <th className="px-4 py-3 text-right font-semibold">Relative Effort</th>
              </tr>
            </thead>
            <tbody>
              {recentSlice.map((a) => {
                const pctThreshold = a.average_heart_rate && thresholdHr ? Math.round((a.average_heart_rate / thresholdHr) * 100) : null;
                return (
                  <tr
                    key={a.id}
                    onClick={() => setOpenActivity(a)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{fmt(new Date(a.start_date), locale, { day: "numeric", month: "short" })}</td>
                    {isMultiple && <td className="px-2 py-2.5 font-medium">{athleteBySlug[a.athleteSlug]?.initials ?? "?"}</td>}
                    <td className="max-w-[220px] truncate px-2 py-2.5">{a.name}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{hm(a.moving_time_s / 60, locale as "es" | "en")}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{a.distance_m ? `${(a.distance_m / 1000).toFixed(1)} km` : "N/A"}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                      {a.average_heart_rate ? `${Math.round(a.average_heart_rate)} bpm${pctThreshold ? ` (${pctThreshold}%)` : ""}` : "N/A"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{a.average_cadence ? Math.round(a.average_cadence) : "N/A"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{a.relative_effort ?? "N/A"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <ActivityDetailDialog activity={openActivity} onClose={() => setOpenActivity(null)} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-3">{sub}</p>
    </Card>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 4;
  const steps = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 10) * 10;
}

function VolumeChart({ workouts, locale }: { workouts: WorkoutWithSlug[]; locale: string }) {
  const n = 12;
  const st = addDays(monday(today()), -28);
  const W = 720;
  const H = 230;
  const L = 34;
  const R = 6;
  const Tp = 18;
  const B = 24;
  const pw = W - L - R;
  const ph = H - Tp - B;

  const weeks = Array.from({ length: n }, (_, i) => ({ d: addDays(st, 7 * i), sports: {} as Record<string, { d: number; p: number }>, tot: 0 }));
  workouts.forEach((w) => {
    const idx = Math.floor(dayDiff(st, parseYmd(w.date)) / 7);
    if (idx < 0 || idx >= n) return;
    const bucket = weeks[idx];
    const o = bucket.sports[w.sport] ?? (bucket.sports[w.sport] = { d: 0, p: 0 });
    if (w.done) o.d += w.minutes;
    else o.p += w.minutes;
    bucket.tot += w.minutes;
  });

  const maxHrs = niceMax(Math.max(0, ...weeks.map((w) => hrs(w.tot))));
  const y = (h: number) => Tp + ph - (h / maxHrs) * ph;
  const slot = pw / n;
  const bw = slot * 0.62;
  const sportColors: Record<string, string> = {
    swim: "var(--swim)",
    bike: "var(--bike)",
    run: "var(--run)",
    gym: "var(--gym)",
    race: "var(--race)",
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="weekly volume">
      {[0, 1, 2, 3, 4].map((k) => {
        const v = (maxHrs * k) / 4;
        return (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
              {Math.round(v * 10) / 10}
            </text>
          </g>
        );
      })}
      {weeks.map((w, i) => {
        const x0 = L + slot * i + (slot - bw) / 2;
        const isCurrent = i === 4;
        let acc = 0;
        return (
          <g key={i}>
            {isCurrent && <rect x={L + slot * i} y={Tp} width={slot} height={ph} rx={4} fill="var(--surface-2)" />}
            {SPORTS.filter((s) => s !== "race" || w.sports.race).map((sport) => {
              const o = w.sports[sport];
              if (!o) return null;
              const segs: [number, number][] = [];
              if (o.d) segs.push([o.d, 1]);
              if (o.p) segs.push([o.p, 0.36]);
              return segs.map(([mins, opacity], si) => {
                const h = hrs(mins);
                const top = y(hrs(acc) + h);
                const ht = y(hrs(acc)) - top;
                acc += mins;
                return (
                  <rect
                    key={sport + si}
                    x={x0}
                    y={top}
                    width={bw}
                    height={Math.max(ht, 0)}
                    fill={sportColors[sport]}
                    opacity={opacity}
                  />
                );
              });
            })}
            {w.tot > 0 && (
              <text x={x0 + bw / 2} y={y(hrs(w.tot)) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                {Math.round(hrs(w.tot) * 10) / 10}
              </text>
            )}
            <text x={x0 + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-3)" fontWeight={isCurrent ? 700 : 400}>
              {/* Found live (Nov 2026, full codebase audit): this was
                  hardcoded to "es", so an English-locale viewer still saw
                  Spanish month abbreviations under every weekly bar. */}
              {fmt(w.d, locale, { day: "numeric", month: "short" })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
