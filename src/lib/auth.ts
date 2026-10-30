import { createClient } from "@/lib/supabase/server";
import type { Athlete } from "@/lib/types";

/** The signed-in Supabase user's matching `athletes` row, or null if there's
 * no session or that user hasn't been linked to an athlete yet (see
 * CLAUDE.md — linking is a one-time manual step after creating the two
 * Supabase Auth accounts). */
export async function getSignedInAthlete(): Promise<Athlete | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("athletes").select("*").eq("auth_user_id", user.id).maybeSingle();
  return (data as Athlete) ?? null;
}
