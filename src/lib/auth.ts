import { createServiceClient } from "@/lib/supabase/server";
import type { Athlete, AthleteSlug } from "@/lib/types";

/**
 * Looks up an athlete row by slug. Used by every Strava route instead of a
 * signed-in session, since auth is deliberately switched off for now (see
 * the RLS note in supabase/schema.sql) — the caller passes which athlete
 * it's acting on explicitly (the athlete picker in Settings), rather than
 * this being derived from `supabase.auth.getUser()`.
 */
export async function getAthleteBySlug(slug: string): Promise<Athlete | null> {
  if (slug !== "juan" && slug !== "jose") return null;
  const db = createServiceClient();
  const { data } = await db.from("athletes").select("*").eq("slug", slug as AthleteSlug).maybeSingle();
  return (data as Athlete) ?? null;
}
