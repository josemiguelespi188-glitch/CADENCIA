"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import type { Community } from "@/lib/types";

/**
 * One community's roster — Phase 1 (see CLAUDE.md's "Community"
 * section). Comparing two members' profiles and aggregate community
 * stats are a deliberate fast-follow, not built here — this page is
 * just "who's in this community, and am I."
 */
export default function CommunityDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { me, athletes } = useAuth();

  const [community, setCommunity] = useState<Community | null | undefined>(undefined);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: comm } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
    setCommunity((comm as Community) ?? null);
    if (comm) {
      const { data: members } = await supabase.from("community_members").select("athlete_id").eq("community_id", comm.id);
      setMemberIds((members ?? []).map((m) => m.athlete_id));
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
  const members = memberIds.map((id) => athletes.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-3xl">
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

              {error && <p className="mb-4 text-sm text-error">{error}</p>}

              <h2 className="mb-3 text-sm uppercase tracking-widest text-ink-3">
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
                      <div>
                        <p className="text-sm font-medium">
                          {a.name}
                          {a.id === community.created_by && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-3">
                              {isEn ? "Coach" : "Coach"}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
