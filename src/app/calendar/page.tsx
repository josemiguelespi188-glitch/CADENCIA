"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { WorkoutDialog, type WorkoutFormValue, type WorkoutWithSlug } from "@/components/WorkoutDialog";
import { NewWorkoutLauncher } from "@/components/NewWorkoutLauncher";
import { ActivityDetailDialog } from "@/components/ActivityDetailDialog";
import { DashboardPanel } from "@/components/DashboardPanel";
import {
  SPORTS,
  type ActivityWithSlug,
  type AthleteSlug,
  type Athlete,
  type Sport,
  type StravaActivity,
  type Template,
  type Workout,
} from "@/lib/types";
import { addDays, fmt, hm, monday, parseYmd, today, ymd } from "@/lib/dates";
import { buildWeekIcs, downloadIcs } from "@/lib/ics";
import { mapStravaSportType } from "@/lib/sport";
import { cn } from "@/lib/utils";

type EditingState = { record: WorkoutWithSlug | null; defaultDate?: string; defaultAthlete?: AthleteSlug; defaultSport?: Sport } | null;

export default function CalendarPage() {
  const { t, locale } = useLocale();
  const { me, athletes, athleteBySlug, viewing, isMultiple } = useAuth();

  const [workouts, setWorkouts] = useState<WorkoutWithSlug[]>([]);
  const [activities, setActivities] = useState<ActivityWithSlug[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => today());
  const [editing, setEditing] = useState<EditingState>(null);
  const [launcherDate, setLauncherDate] = useState<string | null>(null);
  const [openActivity, setOpenActivity] = useState<ActivityWithSlug | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: w }, { data: tpl }, { data: acts }] = await Promise.all([
      supabase.from("workouts").select("*").order("date", { ascending: true }),
      supabase.from("templates").select("*"),
      // Last 30 days only — "no necesito lo histórico, solamente el
      // último mes" — see CLAUDE.md's "Calendar shows real Strava
      // activity" note.
      supabase
        .from("strava_activities")
        .select("*")
        .gte("local_date", ymd(addDays(today(), -30)))
        .order("local_date", { ascending: true }),
    ]);
    // `athletes` (the roster) comes from AuthProvider now, not a separate
    // fetch here — it already loads it once, reactively.
    const byId = new Map(athletes.map((a) => [a.id, a.slug]));
    const workoutRows = ((w as Workout[]) ?? []).map((row) => ({ ...row, athleteSlug: byId.get(row.athlete_id) ?? "" }));
    setWorkouts(workoutRows);
    // Kept unfiltered here (every last-30-days activity, linked or not) —
    // the merged-in DashboardPanel below needs the full set for Recent
    // Activities/Best Efforts/totals; the calendar grid itself filters out
    // already-linked activities separately, see `visibleActivities` below.
    setActivities(((acts as StravaActivity[]) ?? []).map((row) => ({ ...row, athleteSlug: byId.get(row.athlete_id) ?? "" })));
    setTemplates((tpl as Template[]) ?? []);
    setLoading(false);
  }, [athletes]);

  useEffect(() => {
    // Initial data fetch on mount — synchronizing with Supabase, the
    // canonical use for an effect; the lint rule can't see through
    // `load`'s own setState calls, so it flags this call site itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const visible = useMemo(
    () => workouts.filter((w) => viewing.includes(w.athleteSlug)),
    [workouts, viewing]
  );
  const linkedActivityIds = useMemo(
    () => new Set(workouts.map((w) => w.strava_activity_id).filter(Boolean)),
    [workouts]
  );
  /** Unlinked activities only, for the week/month chips — see
   * CLAUDE.md's "Calendar shows real Strava activity" note. */
  const visibleActivities = useMemo(
    () => activities.filter((a) => !linkedActivityIds.has(a.id) && viewing.includes(a.athleteSlug)),
    [activities, linkedActivityIds, viewing]
  );

  async function saveWorkout(value: WorkoutFormValue, existingId: string | null) {
    const supabase = createClient();
    const athlete = athletes.find((a) => a.slug === value.athleteSlug);
    if (!athlete) return;
    const payload = {
      athlete_id: athlete.id,
      date: value.date,
      sport: value.sport,
      title: value.title || t(value.sport),
      workout_type: value.workoutType,
      start: value.start || null,
      minutes: value.minutes,
      km: value.km,
      notes: value.notes,
      strava_comment: value.stravaComment,
      done: value.done,
      rpe: value.rpe,
      workout_steps: value.workoutSteps,
    };
    if (existingId) {
      await supabase.from("workouts").update(payload).eq("id", existingId);
    } else {
      await supabase.from("workouts").insert(payload);
    }
    await load();
  }

  async function deleteWorkout(id: string) {
    const supabase = createClient();
    await supabase.from("workouts").delete().eq("id", id);
    await load();
  }

  async function toggleDone(w: WorkoutWithSlug) {
    setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, done: !x.done } : x)));
    const supabase = createClient();
    const { error } = await supabase.from("workouts").update({ done: !w.done }).eq("id", w.id);
    // Found live (Nov 2026, full codebase audit): this optimistic update
    // was never checked for a write failure or rolled back — a failed
    // write left the checkbox showing "done" in the UI while the
    // database row stayed untouched, silently reverting on the next
    // reload with no error ever shown.
    if (error) {
      console.error("Failed to toggle workout done", error);
      setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, done: w.done } : x)));
    }
  }

  function openAdd(date: string) {
    setLauncherDate(date);
  }

  function pickSport(sport: Sport) {
    if (!launcherDate) return;
    setEditing({ record: null, defaultDate: launcherDate, defaultAthlete: me?.slug, defaultSport: sport });
    setLauncherDate(null);
  }

  function pickAI() {
    if (!launcherDate) return;
    setEditing({ record: null, defaultDate: launcherDate, defaultAthlete: me?.slug });
    setLauncherDate(null);
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : (
            <>
              <Toolbar
                view={view}
                setView={setView}
                anchor={anchor}
                setAnchor={setAnchor}
                visible={visible}
                athleteBySlug={athleteBySlug}
                isMultiple={isMultiple}
                locale={locale}
                t={t}
                onAdd={() => openAdd(ymd(anchor >= today() || view === "month" ? anchor : today()))}
              />
              {view === "week" ? (
                <WeekView
                  anchor={anchor}
                  visible={visible}
                  activities={visibleActivities}
                  athleteBySlug={athleteBySlug}
                  isMultiple={isMultiple}
                  locale={locale}
                  t={t}
                  onAdd={openAdd}
                  onToggle={toggleDone}
                  onEdit={(w) => setEditing({ record: w })}
                  onOpenActivity={setOpenActivity}
                />
              ) : (
                <MonthView
                  anchor={anchor}
                  visible={visible}
                  activities={visibleActivities}
                  locale={locale}
                  onDayClick={(d) => {
                    setView("week");
                    setAnchor(d);
                  }}
                />
              )}
              <DashboardPanel viewing={viewing} athletes={athletes} workouts={workouts} activities={activities} />
            </>
          )}
        </div>
      </main>

      <NewWorkoutLauncher date={launcherDate} onClose={() => setLauncherDate(null)} onPickSport={pickSport} onPickAI={pickAI} />
      <WorkoutDialog
        editing={editing}
        templates={templates}
        athletes={athletes}
        onClose={() => setEditing(null)}
        onSave={saveWorkout}
        onDelete={deleteWorkout}
      />
      <ActivityDetailDialog activity={openActivity} onClose={() => setOpenActivity(null)} />
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────

function Toolbar({
  view,
  setView,
  anchor,
  setAnchor,
  visible,
  athleteBySlug,
  isMultiple,
  locale,
  t,
  onAdd,
}: {
  view: "week" | "month";
  setView: (v: "week" | "month") => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  visible: WorkoutWithSlug[];
  athleteBySlug: Record<string, Athlete>;
  isMultiple: boolean;
  locale: string;
  t: (k: string) => string;
  onAdd: () => void;
}) {
  const start = monday(anchor);
  const end = addDays(start, 6);
  const label =
    view === "week"
      ? `${fmt(start, locale, { day: "numeric", month: "short" })} – ${fmt(end, locale, { day: "numeric", month: "short", year: "numeric" })}`
      : fmt(anchor, locale, { month: "long", year: "numeric" });

  const items =
    view === "week"
      ? visible.filter((w) => {
          const d = parseYmd(w.date);
          return d >= start && d <= end;
        })
      : visible.filter((w) => {
          const d = parseYmd(w.date);
          return d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear();
        });
  const plannedMin = items.reduce((a, w) => a + w.minutes, 0);
  const doneMin = items.filter((w) => w.done).reduce((a, w) => a + w.minutes, 0);

  function nav(n: number) {
    setAnchor(view === "week" ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
  }

  function downloadWeek() {
    const ics = buildWeekIcs(items, athleteBySlug, isMultiple, t);
    downloadIcs(`cadencia-week-${ymd(start)}.ics`, ics);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <h1 className="text-2xl font-semibold tracking-tight mr-auto">{label}</h1>
      <span className="text-sm text-ink-3">
        {items.length} {t("sessions")} · {hm(plannedMin, locale as "es" | "en")} {t("planned")} · {hm(doneMin, locale as "es" | "en")} {t("done")}
      </span>
      <div className="inline-flex rounded-full bg-surface-2 p-1 gap-0.5">
        {(["week", "month"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
              view === v ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"
            )}
          >
            {t(v)}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <Button variant="steel" size="sm" onClick={() => nav(-1)} aria-label={t("prev")}>
          ‹
        </Button>
        <Button variant="steel" size="sm" onClick={() => setAnchor(today())}>
          {t("today")}
        </Button>
        <Button variant="steel" size="sm" onClick={() => nav(1)} aria-label={t("next")}>
          ›
        </Button>
      </div>
      {view === "week" && items.length > 0 && (
        <Button variant="steel" size="sm" onClick={downloadWeek}>
          {t("download_week")}
        </Button>
      )}
      <Button size="sm" onClick={onAdd}>
        + {t("add")}
      </Button>
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────

function sortWorkouts(a: Workout, b: Workout) {
  return (
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    ((a.start || "") < (b.start || "") ? -1 : (a.start || "") > (b.start || "") ? 1 : 0) ||
    (SPORTS.indexOf(a.sport) - SPORTS.indexOf(b.sport))
  );
}

function WeekView({
  anchor,
  visible,
  activities,
  athleteBySlug,
  isMultiple,
  locale,
  t,
  onAdd,
  onToggle,
  onEdit,
  onOpenActivity,
}: {
  anchor: Date;
  visible: WorkoutWithSlug[];
  activities: ActivityWithSlug[];
  athleteBySlug: Record<string, Athlete>;
  isMultiple: boolean;
  locale: string;
  t: (k: string) => string;
  onAdd: (date: string) => void;
  onToggle: (w: WorkoutWithSlug) => void;
  onEdit: (w: WorkoutWithSlug) => void;
  onOpenActivity: (a: ActivityWithSlug) => void;
}) {
  const start = monday(anchor);
  const td = today();
  const byDate = new Map<string, WorkoutWithSlug[]>();
  visible.forEach((w) => {
    const arr = byDate.get(w.date) ?? [];
    arr.push(w);
    byDate.set(w.date, arr);
  });
  byDate.forEach((arr) => arr.sort(sortWorkouts));

  const activitiesByDate = new Map<string, ActivityWithSlug[]>();
  activities.forEach((a) => {
    if (!a.local_date) return;
    const arr = activitiesByDate.get(a.local_date) ?? [];
    arr.push(a);
    activitiesByDate.set(a.local_date, arr);
  });

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {Array.from({ length: 7 }).map((_, i) => {
        const d = addDays(start, i);
        const key = ymd(d);
        const items = byDate.get(key) ?? [];
        const dayActivities = activitiesByDate.get(key) ?? [];
        const isToday = +d === +td;
        return (
          <section
            key={key}
            className={cn(
              "flex min-h-[170px] flex-col gap-2 rounded-xl border bg-surface p-2",
              isToday ? "border-2 border-line-strong" : "border-line"
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">
                {fmt(d, locale, { weekday: "short" })}
              </span>
              <span className="text-xl font-bold leading-none">{d.getDate()}</span>
              <button
                onClick={() => onAdd(key)}
                aria-label={t("add")}
                className="ml-auto h-7 w-7 rounded-md border border-dashed border-line text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                +
              </button>
            </div>
            {items.length || dayActivities.length ? (
              <>
                {items.map((w) => (
                  <WorkoutChip key={w.id} w={w} athleteBySlug={athleteBySlug} locale={locale} t={t} onToggle={onToggle} onEdit={onEdit} />
                ))}
                {dayActivities.map((a) => (
                  <ActivityChip key={a.id} a={a} athleteBySlug={athleteBySlug} isMultiple={isMultiple} locale={locale} onOpen={onOpenActivity} />
                ))}
              </>
            ) : (
              <p className="text-xs text-ink-3">{t("free")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A real Strava activity with no matching planned workout — see
 * CLAUDE.md's "Calendar shows real Strava activity" note. Dashed border
 * (vs. the planned chip's solid soft background) is the visual cue that
 * this happened but wasn't planned. */
function ActivityChip({
  a,
  athleteBySlug,
  isMultiple,
  locale,
  onOpen,
}: {
  a: ActivityWithSlug;
  athleteBySlug: Record<string, Athlete>;
  isMultiple: boolean;
  locale: string;
  onOpen: (a: ActivityWithSlug) => void;
}) {
  const sport = mapStravaSportType(a.sport_type);
  const metaParts = [
    a.moving_time_s ? hm(a.moving_time_s / 60, locale as "es" | "en") : "",
    a.distance_m ? `${(a.distance_m / 1000).toFixed(1)} km` : "",
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className={cn(sport ? "s-" + sport : "", "flex w-full items-start gap-1.5 rounded-lg border border-dashed p-1.5 text-left hover:bg-surface-2")}
      style={{ borderColor: sport ? "var(--c)" : "var(--line)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sport ? "var(--c)" : "var(--ink-3)" }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Strava</span>
          {isMultiple && (
            <span className="ml-auto rounded border border-line bg-surface px-1 text-[10px] font-bold">
              {athleteBySlug[a.athleteSlug]?.initials ?? "?"}
            </span>
          )}
        </div>
        <p className="text-sm font-medium break-words">{a.name}</p>
        {metaParts.length > 0 && <p className="text-xs text-ink-3">{metaParts.join(" · ")}</p>}
      </div>
    </button>
  );
}

function WorkoutChip({
  w,
  athleteBySlug,
  locale,
  t,
  onToggle,
  onEdit,
}: {
  w: WorkoutWithSlug;
  athleteBySlug: Record<string, Athlete>;
  locale: string;
  t: (k: string) => string;
  onToggle: (w: WorkoutWithSlug) => void;
  onEdit: (w: WorkoutWithSlug) => void;
}) {
  const metaParts = [w.start, w.minutes ? hm(w.minutes, locale as "es" | "en") : "", w.km ? `${w.km} km` : ""].filter(Boolean);
  return (
    <div className={cn("s-" + w.sport, "flex items-start gap-1.5 rounded-lg p-1.5")} style={{ background: "var(--soft)" }}>
      <button
        type="button"
        onClick={() => onToggle(w)}
        aria-pressed={w.done}
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2"
        style={{ borderColor: "var(--c)", background: w.done ? "var(--c)" : "transparent" }}
      >
        {w.done && (
          <svg width="11" height="11" viewBox="0 0 14 14">
            <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <button type="button" onClick={() => onEdit(w)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--c)" }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c)" }}>
            {t(w.sport)}
          </span>
          <span className="ml-auto rounded border border-line bg-surface px-1 text-[10px] font-bold">
            {athleteBySlug[w.athleteSlug]?.initials ?? "?"}
          </span>
        </div>
        <p className={cn("text-sm font-medium break-words", w.done && "line-through opacity-60")}>{w.title}</p>
        {metaParts.length > 0 && <p className="text-xs text-ink-3">{metaParts.join(" · ")}</p>}
      </button>
    </div>
  );
}

// ─── Month view ───────────────────────────────────────────────────────────

function MonthView({
  anchor,
  visible,
  activities,
  locale,
  onDayClick,
}: {
  anchor: Date;
  visible: WorkoutWithSlug[];
  activities: ActivityWithSlug[];
  locale: string;
  onDayClick: (d: Date) => void;
}) {
  const td = today();
  const byDate = new Map<string, WorkoutWithSlug[]>();
  visible.forEach((w) => {
    const arr = byDate.get(w.date) ?? [];
    arr.push(w);
    byDate.set(w.date, arr);
  });
  const activitiesByDate = new Map<string, ActivityWithSlug[]>();
  activities.forEach((a) => {
    if (!a.local_date) return;
    const arr = activitiesByDate.get(a.local_date) ?? [];
    arr.push(a);
    activitiesByDate.set(a.local_date, arr);
  });

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = monday(first);
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((((first.getDay() + 6) % 7) + daysInMonth) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i));
  const dowLabels = Array.from({ length: 7 }, (_, i) => fmt(addDays(gridStart, i), locale, { weekday: "short" }));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-widest text-ink-3">
        {dowLabels.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = ymd(d);
          const items = (byDate.get(key) ?? []).sort(sortWorkouts);
          const dayActivities = activitiesByDate.get(key) ?? [];
          const off = d.getMonth() !== anchor.getMonth();
          const isToday = +d === +td;
          const total = items.length + dayActivities.length;
          return (
            <button
              key={key}
              onClick={() => onDayClick(d)}
              className={cn(
                "flex min-h-[90px] flex-col gap-1 rounded-lg border bg-surface p-1.5 text-left",
                off && "opacity-50",
                isToday ? "border-2 border-line-strong" : "border-line"
              )}
            >
              <span className="text-sm font-bold">{d.getDate()}</span>
              {items.slice(0, 3).map((w) => (
                <div
                  key={w.id}
                  className={cn("s-" + w.sport, "flex items-center gap-1 truncate rounded px-1 text-[11px]")}
                  style={{ background: "var(--soft)" }}
                  title={w.title}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--c)" }} />
                  <span className={cn("truncate", w.done && "line-through opacity-60")}>{w.title}</span>
                </div>
              ))}
              {dayActivities.slice(0, Math.max(0, 3 - items.length)).map((a) => {
                const sport = mapStravaSportType(a.sport_type);
                return (
                  <div
                    key={a.id}
                    className={cn(sport ? "s-" + sport : "", "flex items-center gap-1 truncate rounded border border-dashed px-1 text-[11px]")}
                    style={{ borderColor: sport ? "var(--c)" : "var(--line)" }}
                    title={a.name}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sport ? "var(--c)" : "var(--ink-3)" }} />
                    <span className="truncate">{a.name}</span>
                  </div>
                );
              })}
              {total > 3 && <span className="text-[10px] text-ink-3">+{total - 3}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
