"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { slugify, dedupeSlug } from "@/lib/athleteSlug";
import type { Community } from "@/lib/types";

/**
 * Community directory — Phase 1 of a larger feature (see CLAUDE.md's
 * "Community" section for the full build plan; compare-profiles and
 * aggregate stats are a deliberate fast-follow, not built here).
 *
 * A coach (or admin) creates a community, any signed-in athlete can join
 * one — "automático, sin solicitud," the exact same open-join philosophy
 * already confirmed for the Friends picker, so joining/leaving is a
 * direct RLS-governed insert/delete of your own `community_members` row,
 * no server route needed (mirrors how `workouts`/`templates` already
 * work in this app). This is the first feature with any real privacy
 * boundary though: creating one requires `is_coach`/`is_admin`, enforced
 * in RLS on the `communities` table itself.
 */
export default function CommunityPage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { me, athletes } = useAuth();

  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [myCommunityIds, setMyCommunityIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: comms }, { data: members }] = await Promise.all([
      supabase.from("communities").select("*").order("name"),
      supabase.from("community_members").select("community_id, athlete_id"),
    ]);
    setCommunities((comms as Community[]) ?? []);
    const counts: Record<string, number> = {};
    const mine = new Set<string>();
    for (const m of members ?? []) {
      counts[m.community_id] = (counts[m.community_id] ?? 0) + 1;
      if (me && m.athlete_id === me.id) mine.add(m.community_id);
    }
    setMemberCounts(counts);
    setMyCommunityIds(mine);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [me, load]);

  async function join(communityId: string) {
    if (!me) return;
    setBusyId(communityId);
    setError(null);
    const supabase = createClient();
    const { error: joinError } = await supabase.from("community_members").insert({ community_id: communityId, athlete_id: me.id });
    setBusyId(null);
    if (joinError) {
      setError(joinError.message);
      return;
    }
    await load();
  }

  async function leave(communityId: string) {
    if (!me) return;
    setBusyId(communityId);
    setError(null);
    const supabase = createClient();
    const { error: leaveError } = await supabase
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("athlete_id", me.id);
    setBusyId(null);
    if (leaveError) {
      setError(leaveError.message);
      return;
    }
    await load();
  }

  const canCreate = !!me && (me.is_coach || me.is_admin);
  const mine = (communities ?? []).filter((c) => myCommunityIds.has(c.id));
  const others = (communities ?? []).filter((c) => !myCommunityIds.has(c.id));

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{isEn ? "Community" : "Community"}</h1>
              <p className="text-sm text-ink-3">
                {isEn
                  ? "Your running club, your triathlon group — see who's in it, join one, or start your own."
                  : "Tu running club, tu comunidad de triatlón — mira quién está, únete a una, o crea la tuya."}
              </p>
            </div>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating((v) => !v)}>
                + {isEn ? "Create a community" : "Crear comunidad"}
              </Button>
            )}
          </div>

          {creating && (
            <CreateCommunityForm
              existingSlugs={new Set((communities ?? []).map((c) => c.slug))}
              onDone={async () => {
                setCreating(false);
                await load();
              }}
              onCancel={() => setCreating(false)}
            />
          )}

          {error && <p className="mb-4 text-sm text-error">{error}</p>}

          {communities === null ? (
            <p className="text-ink-3">{isEn ? "Loading…" : "Cargando…"}</p>
          ) : communities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center text-ink-3">
              {isEn
                ? canCreate
                  ? "No communities yet — create the first one."
                  : "No communities yet. Ask a coach to create one."
                : canCreate
                  ? "Todavía no hay comunidades — crea la primera."
                  : "Todavía no hay comunidades. Pídele a un coach que cree una."}
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {mine.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm uppercase tracking-widest text-ink-3">
                    {isEn ? "My communities" : "Mis comunidades"}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {mine.map((c) => (
                      <CommunityCard
                        key={c.id}
                        community={c}
                        memberCount={memberCounts[c.id] ?? 0}
                        coachName={athletes.find((a) => a.id === c.created_by)?.name ?? null}
                        isMember
                        busy={busyId === c.id}
                        onJoin={() => join(c.id)}
                        onLeave={() => leave(c.id)}
                        isEn={isEn}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-3 text-sm uppercase tracking-widest text-ink-3">
                  {isEn ? "All communities" : "Todas las comunidades"}
                </h2>
                {others.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    {isEn ? "You're already in every community." : "Ya estás en todas las comunidades."}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {others.map((c) => (
                      <CommunityCard
                        key={c.id}
                        community={c}
                        memberCount={memberCounts[c.id] ?? 0}
                        coachName={athletes.find((a) => a.id === c.created_by)?.name ?? null}
                        isMember={false}
                        busy={busyId === c.id}
                        onJoin={() => join(c.id)}
                        onLeave={() => leave(c.id)}
                        isEn={isEn}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function CommunityCard({
  community,
  memberCount,
  coachName,
  isMember,
  busy,
  onJoin,
  onLeave,
  isEn,
}: {
  community: Community;
  memberCount: number;
  coachName: string | null;
  isMember: boolean;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  isEn: boolean;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <Link href={`/community/${community.slug}`} className="font-semibold hover:underline">
        {community.name}
      </Link>
      {community.description && <p className="text-sm text-ink-2">{community.description}</p>}
      <p className="text-xs text-ink-3">
        {memberCount} {memberCount === 1 ? (isEn ? "member" : "miembro") : isEn ? "members" : "miembros"}
        {coachName ? ` · ${isEn ? "Coach" : "Coach"}: ${coachName}` : ""}
      </p>
      <div className="mt-1 flex gap-2">
        <Link href={`/community/${community.slug}`}>
          <Button size="sm" variant="ghost">
            {isEn ? "View" : "Ver"}
          </Button>
        </Link>
        {isMember ? (
          <Button size="sm" variant="danger" onClick={onLeave} disabled={busy}>
            {isEn ? "Leave" : "Salir"}
          </Button>
        ) : (
          <Button size="sm" onClick={onJoin} disabled={busy}>
            {isEn ? "Join" : "Unirme"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function CreateCommunityForm({
  existingSlugs,
  onDone,
  onCancel,
}: {
  existingSlugs: Set<string>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { me } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError(null);
    const slug = dedupeSlug(slugify(name), existingSlugs);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("communities")
      .insert({ slug, name, description, created_by: me.id });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setDescription("");
    await onDone();
  }

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{isEn ? "Name" : "Nombre"}</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isEn ? "e.g. Lima Triathlon Club" : "ej. Club de Triatlón Lima"}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{isEn ? "Description" : "Descripción"}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-16 resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {busy ? (isEn ? "Creating…" : "Creando…") : isEn ? "Create" : "Crear"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {isEn ? "Cancel" : "Cancelar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
