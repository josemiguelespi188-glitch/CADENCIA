import { createClient } from "@/lib/supabase/server";
import type { Athlete } from "@/lib/types";

/** The signed-in Supabase user's matching `athletes` row, from the real
 * session cookie — the one, correct way every server-side route now
 * derives "which athlete is this" (see CLAUDE.md's "Real auth + admin"
 * section for why this replaced the old client-supplied-slug pattern). */
export async function getSignedInAthlete(): Promise<Athlete | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("athletes").select("*").eq("auth_user_id", user.id).maybeSingle();
  return (data as Athlete) ?? null;
}

/** Throws if there's no signed-in athlete, or they're not an admin — every
 * /api/admin/* route calls this first. */
export async function requireAdmin(): Promise<Athlete> {
  const athlete = await getSignedInAthlete();
  if (!athlete || !athlete.is_admin) throw new Error("Not authorized");
  return athlete;
}
