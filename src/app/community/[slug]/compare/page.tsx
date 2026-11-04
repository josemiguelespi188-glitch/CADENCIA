"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { CompareProfiles } from "@/components/CompareProfiles";
import type { ActivityWithSlug, Athlete, Community, StravaActivity } from "@/lib/types";
import type { DailyLoad } from "@/lib/fitnessForm";

/**
 * "Comparar nuestros dos perfiles" — Community Phase 2 (see CLAUDE.md's
 * "Community" section). Defaults the left side to the signed-in athlete
 * and lets you pick who to compare against from the community's own
 * roster via `?with=<athleteId>`; with no pick yet, shows a picker
 * instead of guessing a second athlete.
 */
export default function CommunityComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { me, athletes } = useAuth();

  const [community, setCommunity] = useState<Community | null | undefined>(undefined);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [withId, setWithId] = useState<string | null>(null);
  const [activitiesA, setActivitiesA] = useState<ActivityWithSlug[]>([]);
  const [activitiesB, setActivitiesB] = useState<ActivityWithSlug[]>([]);
  const [whoopA, setWhoopA] = useState<DailyLoad[]>([]);
  const [whoopB, setWhoopB] = useState<DailyLoad[]>([]);
  const [loadingPair, setLoadingPair] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWithId(params.get("with"));
  }, []);

  const loadCommunity = useCallback(async () => {
    const supabase = createClient();
    const { data: comm } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
    setCommunity((comm as Community) ?? null);
    if (comm) {
      const { data: members } = await supabase.from("community_members").select("athlete_id").eq("community_id", comm.id);
      setMemberIds((members ?? []).map((m) => m.athlete_id));
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCommunity();
  }, [loadCommunity]);

  const other = withId ? (athletes.find((x) => x.id === withId) ?? null) : null;

  const loadPair = useCallback(async (a: Athlete, b: Athlete) => {
    setLoadingPair(true);
    const supabase = createClient();
    const [actsA, actsB, cyclesA, cyclesB] = await Promise.all([
      supabase.from("strava_activities").select("*").eq("athlete_id", a.id),
      supabase.from("strava_activities").select("*").eq("athlete_id", b.id),
      supabase.from("whoop_cycles").select("start_at, strain").eq("athlete_id", a.id).order("start_at", { ascending: true }),
      supabase.from("whoop_cycles").select("start_at, strain").eq("athlete_id", b.id).order("start_at", { ascending: true }),
    ]);
    setActivitiesA(toActivities(actsA.data ?? [], a.slug));
    setActivitiesB(toActivities(actsB.data ?? [], b.slug));
    setWhoopA(toDailyLoad(cyclesA.data ?? []));
    setWhoopB(toDailyLoad(cyclesB.data ?? []));
    setLoadingPair(false);
  }, []);

  useEffect(() => {
    if (me && other) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPair(me, other);
    }
  }, [me, other, loadPair]);

  const candidateIds = memberIds.filter((id) => id !== me?.id);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-3xl">
          <Link href={`/community/${slug}`} className="mb-4 inline-block text-xs text-ink-3 hover:text-ink">
            ← {community === undefined ? "…" : community?.name ?? (isEn ? "Community" : "Comunidad")}
          </Link>

          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{isEn ? "Compare profiles" : "Comparar perfiles"}</h1>

          {!me ? null : !other ? (
            <div>
              <p className="mb-4 text-sm text-ink-2">{isEn ? "Who do you want to compare yourself with?" : "¿Con quién te quieres comparar?"}</p>
              {candidateIds.length === 0 ? (
                <p className="text-sm text-ink-3">{isEn ? "No one else here yet." : "Todavía no hay nadie más aquí."}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidateIds.map((id) => {
                    const ath = athletes.find((x) => x.id === id);
                    if (!ath) return null;
                    return (
                      <Link
                        key={id}
                        href={`/community/${slug}/compare?with=${id}`}
                        onClick={() => setWithId(id)}
                        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line-strong"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-bg">{ath.initials}</span>
                        <p className="text-sm font-medium">{ath.name}</p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : loadingPair ? (
            <p className="text-ink-3">{isEn ? "Loading…" : "Cargando…"}</p>
          ) : (
            <CompareProfiles a={me} b={other} activitiesA={activitiesA} activitiesB={activitiesB} whoopLoadsA={whoopA} whoopLoadsB={whoopB} />
          )}
        </div>
      </main>
    </div>
  );
}

function toActivities(rows: StravaActivity[], slug: string): ActivityWithSlug[] {
  return rows.map((r) => ({ ...r, athleteSlug: slug }));
}

function toDailyLoad(rows: { start_at: string; strain: number | null }[]): DailyLoad[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (r.strain === null) continue;
    const date = r.start_at.slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + Number(r.strain));
  }
  return Array.from(byDate.entries())
    .map(([date, stress]) => ({ date, stress }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
