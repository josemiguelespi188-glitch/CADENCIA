"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { AssignCommunityWorkoutDialog } from "@/components/AssignCommunityWorkoutDialog";
import { CommunityCountdown } from "@/components/CommunityCountdown";
import { CommunityFitnessChart } from "@/components/CommunityFitnessChart";
import { computeCommunityStats } from "@/lib/communityStats";
import { addDays, today, ymd } from "@/lib/dates";
import type { ActivityWithSlug, Community, StravaActivity } from "@/lib/types";

/**
 * One community's roster — Phase 1 (see CLAUDE.md's "Community"
 * section), now with Phase 2's aggregate stats/leaderboard, per-member
 * "View profile"/"Compare" links, and a coach's bulk-assign action.
 */
export default function CommunityDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { me, athletes } = useAuth();

  const [community, setCommunity] = useState<Community | null | undefined>(undefined);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [activities, setActivities] = useState<ActivityWithSlug[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: comm } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
    setCommunity((comm as Community) ?? null);
    if (comm) {
      const { data: members } = await supabase.from("community_members").select("athlete_id").eq("community_id", comm.id);
      const ids = (members ?? []).map((m) => m.athlete_id);
      setMemberIds(ids);
      if (ids.length) {
        const { data: acts } = await supabase.from("strava_activities").select("*").in("athlete_id", ids);
        setActivities((acts ?? []).map((a: StravaActivity) => ({ ...a, athleteSlug: "" })));
      } else {
        setActivities([]);
      }
    }
  }, [slug]);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function join() {
    if (!me || !community) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: joinError } = await supabase.from("community_members").insert({ community_id: community.id, athlete_id: me.id });
    setBusy(false);
    if (joinError) {
      setError(joinError.message);
      return;
    }
    await load();
  }

  async function leave() {
    if (!me || !community) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: leaveError } = await supabase
      .from("community_members")
      .delete()
      .eq("community_id", community.id)
      .eq("athlete_id", me.id);
    setBusy(false);
    if (leaveError) {
      setError(leaveError.message);
      return;
    }
    await load();
  }

  const isMember = !!me && memberIds.includes(me.id);
  const coach = community ? athletes.find((a) => a.id === community.created_by) : null;
  const isCoachOrAdmin = !!me && !!community && (me.id === community.created_by || me.is_admin);
  const members = memberIds.map((id) => athletes.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);

  // Nov 2026, direct request: "Aquí no es un last 30 days. sino desde
  // que comienza el entrenamiento hasta que se llega al día del evento
  // deportivo." A community with both dates set gets a window spanning
  // its own training block (capped at today, since there's no synced
  // data beyond "now" anyway); one with no training_start_date set yet
  // falls back to a plain last-30-days window — the original behavior —
  // rather than showing nothing until a coach gets around to setting
  // dates.
  const todayStr = ymd(today());
  const dateRange = community
    ? community.training_start_date
      ? { from: community.training_start_date, to: community.event_date && community.event_date < todayStr ? community.event_date : todayStr }
      : { from: ymd(addDays(today(), -30)), to: todayStr }
    : { from: ymd(addDays(today(), -30)), to: todayStr };
  const stats = computeCommunityStats(activities, new Set(memberIds), dateRange);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-4xl">
          <Link href="/community" className="mb-4 inline-block text-xs text-ink-3 hover:text-ink">
            ← {isEn ? "All communities" : "Todas las comunidades"}
          </Link>

          {community === undefined ? (
            <p className="text-ink-3">{isEn ? "Loading…" : "Cargando…"}</p>
          ) : community === null ? (
            <p className="text-sm text-ink-2">{isEn ? "Community not found." : "Comunidad no encontrada."}</p>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">{community.name}</h1>
                  {community.description && <p className="mt-1 text-sm text-ink-2">{community.description}</p>}
                  {coach && (
                    <p className="mt-1 text-xs text-ink-3">
                      {isEn ? "Coach" : "Coach"}: {coach.name}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isCoachOrAdmin && (
                    <Button size="sm" variant="steel" onClick={() => setAssignOpen(true)}>
                      {isEn ? "Assign workout to everyone" : "Asignar entreno a todos"}
                    </Button>
                  )}
                  {me &&
                    (isMember ? (
                      <Button size="sm" variant="danger" onClick={leave} disabled={busy}>
                        {isEn ? "Leave" : "Salir"}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={join} disabled={busy}>
                        {isEn ? "Join" : "Unirme"}
                      </Button>
                    ))}
                </div>
              </div>

              {error && <p className="mb-4 text-sm text-error">{error}</p>}
              {assignNotice && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">{assignNotice}</p>}

              <CommunityCountdown community={community} isCoachOrAdmin={isCoachOrAdmin} isEn={isEn} onUpdated={load} />

              <CommunityStatsSection stats={stats} isEn={isEn} dateRange={dateRange} />

              {members.length > 0 && (
                <div className="mt-6">
                  <CommunityFitnessChart members={members} dateRange={dateRange} />
                </div>
              )}

              <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-ink-3">
                {isEn ? "Members" : "Miembros"} ({members.length})
              </h2>
              {members.length === 0 ? (
                <p className="text-sm text-ink-3">{isEn ? "No members yet." : "Todavía no hay miembros."}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {members.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-bg">
                        {a.initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {a.name}
                          {a.id === community.created_by && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-3">{isEn ? "Coach" : "Coach"}</span>
                          )}
                        </p>
                      </div>
                      {me && a.id !== me.id && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Link href={`/community/${slug}/member/${a.id}`} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-line-strong hover:text-ink">
                            {isEn ? "Profile" : "Perfil"}
                          </Link>
                          <Link href={`/community/${slug}/compare?with=${a.id}`} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-line-strong hover:text-ink">
                            {isEn ? "Compare" : "Comparar"}
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {assignOpen && (
        <AssignCommunityWorkoutDialog
          memberIds={memberIds}
          onClose={() => setAssignOpen(false)}
          onAssigned={(count) => {
            setAssignOpen(false);
            setAssignNotice(isEn ? `Assigned to ${count} athlete(s).` : `Asignado a ${count} atleta(s).`);
          }}
        />
      )}
    </div>
  );
}

const SPORT_LABEL: Record<string, { en: string; es: string }> = {
  swim: { en: "Swim", es: "Natación" },
  bike: { en: "Bike", es: "Bici" },
  run: { en: "Run", es: "Trote" },
  gym: { en: "Gym", es: "Gimnasio" },
  other: { en: "Other", es: "Otro" },
};

function CommunityStatsSection({
  stats,
  isEn,
  dateRange,
}: {
  stats: ReturnType<typeof computeCommunityStats>;
  isEn: boolean;
  dateRange: { from: string; to: string };
}) {
  const { athletes } = useAuth();
  const totalKm = stats.totalDistanceM / 1000;
  const totalHrs = stats.totalMovingTimeS / 3600;
  const maxDist = Math.max(1, ...stats.leaderboard.map((m) => m.distanceM));
  const windowLabel = isEn ? `${dateRange.from} to ${dateRange.to}` : `${dateRange.from} a ${dateRange.to}`;

  return (
    <div>
      <h2 className="mb-3 text-sm uppercase tracking-widest text-ink-3">
        {isEn ? `Community stats (${windowLabel})` : `Estadísticas de la comunidad (${windowLabel})`}
      </h2>
      {stats.totalCount === 0 ? (
        <p className="text-sm text-ink-3">{isEn ? "No synced activity from this community yet." : "Todavía no hay actividad sincronizada de esta comunidad."}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{isEn ? "Total distance" : "Distancia total"}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {Math.round(totalKm)} km
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{isEn ? "Total time" : "Tiempo total"}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {Math.round(totalHrs)} h
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">{isEn ? "Sessions" : "Sesiones"}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {stats.totalCount}
              </p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardTitle>{isEn ? "By sport" : "Por deporte"}</CardTitle>
              <div className="mt-3 flex flex-col gap-2">
                {stats.bySport.map((s) => {
                  const pct = (s.distanceM / Math.max(1, stats.totalDistanceM)) * 100;
                  return (
                    <div key={s.sport} className={"grid grid-cols-[64px_1fr_auto] items-center gap-2 text-sm s-" + s.sport}>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c)" }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: "var(--c)" }} />
                        {isEn ? SPORT_LABEL[s.sport]?.en ?? s.sport : SPORT_LABEL[s.sport]?.es ?? s.sport}
                      </span>
                      <div className="h-2.5 rounded-full" style={{ background: "var(--soft)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--c)" }} />
                      </div>
                      <span className="text-xs tabular-nums text-ink-3">{(s.distanceM / 1000).toFixed(0)} km</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardTitle>{isEn ? "Leaderboard" : "Tabla de posiciones"}</CardTitle>
              <div className="mt-3 flex flex-col gap-2">
                {stats.leaderboard.slice(0, 10).map((m, i) => {
                  const ath = athletes.find((a) => a.id === m.athleteId);
                  const pct = (m.distanceM / maxDist) * 100;
                  return (
                    <div key={m.athleteId} className="grid grid-cols-[18px_80px_1fr_auto] items-center gap-2 text-sm">
                      <span className="text-xs font-bold text-ink-3">{i + 1}</span>
                      <span className="truncate font-medium">{ath?.name ?? "?"}</span>
                      <div className="h-2.5 rounded-full bg-[var(--surface-2)]">
                        <div className="h-full rounded-full bg-[var(--bike)]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-ink-3">{(m.distanceM / 1000).toFixed(1)} km</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
