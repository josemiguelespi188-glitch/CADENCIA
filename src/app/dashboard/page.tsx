"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { useAthleteView } from "@/lib/athlete-view-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { ATHLETES, SPORTS, type Athlete, type AthleteSlug, type StravaActivity, type Workout } from "@/lib/types";
import { addDays, dayDiff, fmt, hm, hrs, monday, parseYmd, today } from "@/lib/dates";
import { cn } from "@/lib/utils";

type WorkoutWithSlug = Workout & { athleteSlug: AthleteSlug };

export default function DashboardPage() {
  const { t, locale } = useLocale();
  const { who } = useAthleteView();

  const [loading, setLoading] = useState(true);
  const [workouts, setWorkouts] = useState<WorkoutWithSlug[]>([]);
  const [activities, setActivities] = useState<(StravaActivity & { athleteSlug: AthleteSlug })[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: ath }, { data: w }, { data: acts }] = await Promise.all([
      supabase.from("athletes").select("*"),
      supabase.from("workouts").select("*"),
      supabase.from("strava_activities").select("*").order("start_date", { ascending: false }).limit(40),
    ]);
    const athleteList = (ath as Athlete[]) ?? [];
    const byId = new Map(athleteList.map((a) => [a.id, a.slug]));
    setWorkouts(((w as Workout[]) ?? []).map((row) => ({ ...row, athleteSlug: byId.get(row.athlete_id) ?? "juan" })));
    setActivities(
      ((acts as StravaActivity[]) ?? []).map((row) => ({ ...row, athleteSlug: byId.get(row.athlete_id) ?? "juan" }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const visible = useMemo(
    () => (who === "both" ? workouts : workouts.filter((w) => w.athleteSlug === who)),
    [workouts, who]
  );
  const visibleActivities = useMemo(
    () => (who === "both" ? activities : activities.filter((a) => a.athleteSlug === who)),
    [activities, who]
  );

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

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("nav_dashboard")}</h1>

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
                  sub={nextRace ? nextRace.title + (who === "both" ? ` · ${ATHLETES[nextRace.athleteSlug].initials}` : "") : t("no_race")}
                />
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
                <Card>
                  <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("vol")}</h3>
                  <VolumeChart workouts={visible} />
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

              <h2 className="mt-8 text-sm uppercase tracking-widest text-ink-3">Strava</h2>
              <div className="mt-3 flex flex-col gap-2">
                {visibleActivities.length === 0 && (
                  <p className="text-sm text-ink-3">
                    {locale === "en" ? "No synced Strava activity yet." : "Todavía no hay actividad sincronizada de Strava."}
                  </p>
                )}
                {visibleActivities.slice(0, 10).map((a) => (
                  <Card key={a.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="text-xs text-ink-3">
                          {fmt(new Date(a.start_date), locale, { day: "numeric", month: "short" })} · {a.sport_type}
                          {who === "both" ? ` · ${ATHLETES[a.athleteSlug].initials}` : ""}
                        </p>
                      </div>
                      <p className="text-xs text-ink-2 tabular-nums">
                        {hm(a.moving_time_s / 60, locale as "es" | "en")} · {(a.distance_m / 1000).toFixed(1)} km
                        {a.average_cadence ? ` · ${Math.round(a.average_cadence)} cad` : ""}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
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

function VolumeChart({ workouts }: { workouts: WorkoutWithSlug[] }) {
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
              {fmt(w.d, "es", { day: "numeric", month: "short" })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
