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
 * since the email matched and was verified), this re-links the row
 * rather than no-opping blindly (see the `auth_user_id` mismatch
 * handling just below — a real bug found live, Nov 2026).
 */
export async function ensureAthleteForUser(user: User): Promise<void> {
  const db = createServiceClient();

  // Found live (Nov 2026, full codebase audit): `email.eq.` is
  // case-sensitive on this plain `text` column — an admin-seeded row
  // with email "JohnDoe@gmail.com" (no auth_user_id yet) wouldn't match
  // a later Google sign-in normalized to "johndoe@gmail.com", inserting
  // a duplicate identity instead of linking to the existing row. `ilike`
  // (no wildcards — an exact case-insensitive match) fixes that.
  const { data: existing } = await db
    .from("athletes")
    .select("id, auth_user_id")
    .or(`auth_user_id.eq.${user.id}${user.email ? `,email.ilike.${user.email}` : ""}`)
    .maybeSingle();
  if (existing) {
    // Found live (Nov 2026): a real, permanent "stuck forever" bug, not
    // just the transient race fixed in `auth-context.tsx` the same day.
    // `athletes.auth_user_id` is `on delete set null` — deleting a
    // Supabase Auth user (e.g. to let someone re-register cleanly, as
    // was done live here) leaves their old `athletes` row in place with
    // `auth_user_id = null` and the same email. The match above found
    // that row via `email.ilike`, but this used to just `return` without
    // updating it — the row stayed unlinked forever, `auth_user_id`
    // never matched the brand-new session's `user.id` no matter how
    // many times the retry in `auth-context.tsx` tried, and the athlete
    // was permanently stuck on `NoProfileScreen`. Now: if this row's
    // `auth_user_id` doesn't already equal the signed-in user (null, or
    // any other stale value), re-link it to this session instead of a
    // silent no-op — the whole point of matching by email at all is "this
    // is the same person, reconnect them."
    if (existing.auth_user_id !== user.id) {
      const { error: relinkError } = await db.from("athletes").update({ auth_user_id: user.id }).eq("id", existing.id);
      if (relinkError) console.error("Failed to re-link existing athlete row to new sign-in", relinkError);
    }
    return;
  }

  const displayName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email?.split("@")[0] ||
    "Athlete";

  const { data: roster } = await db.from("athletes").select("slug");
  const existingSlugs = new Set((roster ?? []).map((a) => a.slug));
  const slug = dedupeSlug(slugify(displayName), existingSlugs);

  const { error } = await db.from("athletes").insert({
    slug,
    name: displayName,
    initials: initialsFrom(displayName),
    auth_user_id: user.id,
    email: user.email,
  });
  // Found live (Nov 2026, full codebase audit): this error was never
  // checked. Two near-simultaneous sign-ups with colliding names/emails
  // can both pass the "no existing row" check above before either
  // insert commits — the second insert then fails `athletes`' unique
  // slug/email constraint and, unchecked, silently stranded that user
  // signed in with no athlete row (me === null forever, stuck on a
  // perpetual loading screen). A unique-violation here specifically
  // means a concurrent call already created the row this one needs —
  // not a real failure, so it's swallowed; any other error is still
  // surfaced so a genuine problem doesn't vanish silently.
  if (error && error.code !== "23505") {
    console.error("Failed to create athlete row for new sign-in", error);
    throw error;
  }
}
