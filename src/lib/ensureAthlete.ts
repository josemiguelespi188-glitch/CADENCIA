import type { User } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { slugify, initialsFrom, dedupeSlug } from "@/lib/athleteSlug";

/**
 * Open self-registration via Google (Oct 2026, explicit product choice —
 * see CLAUDE.md's "Google sign-in" section). Unlike every other account
 * on this platform (which only ever exist because an admin invited them
 * from /admin), a Google sign-in auto-creates a brand-new `athletes` row
 * the first time THAT Google account is seen — no invite, no approval
 * step. Called from `/auth/callback` right after the OAuth code exchange,
 * with the service-role client (bypasses RLS, same as the admin invite
 * route) since the brand-new session's own RLS-scoped client can't yet
 * insert a row that represents itself.
 *
 * Idempotent: if a row already exists for this `auth_user_id` (returning
 * athlete) or `email` (e.g. an admin-invited password account whose
 * Supabase identity Supabase auto-linked to this same Google sign-in,
 * since the email matched and was verified), this is a no-op.
 */
export async function ensureAthleteForUser(user: User): Promise<void> {
  const db = createServiceClient();

  const { data: existing } = await db
    .from("athletes")
    .select("id")
    .or(`auth_user_id.eq.${user.id}${user.email ? `,email.eq.${user.email}` : ""}`)
    .maybeSingle();
  if (existing) return;

  const displayName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email?.split("@")[0] ||
    "Athlete";

  const { data: roster } = await db.from("athletes").select("slug");
  const existingSlugs = new Set((roster ?? []).map((a) => a.slug));
  const slug = dedupeSlug(slugify(displayName), existingSlugs);

  await db.from("athletes").insert({
    slug,
    name: displayName,
    initials: initialsFrom(displayName),
    auth_user_id: user.id,
    email: user.email,
  });
}
