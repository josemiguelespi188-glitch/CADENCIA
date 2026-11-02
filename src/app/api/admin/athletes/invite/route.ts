import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/integrations/strava";
import { slugify, initialsFrom, dedupeSlug } from "@/lib/athleteSlug";

/**
 * Invites someone by email, via Supabase Auth's own invite flow (same
 * proven pattern as the Operations Hub codebase's "Team invites" —
 * `supabase.auth.admin.inviteUserByEmail()` on the service-role client,
 * no self-rolled invite-token table). Two shapes, per explicit instruction
 * ("una vez añadido el usuario se manda una invitación a través de mail"):
 *
 * - `existingAthleteId` set: links the new auth account to an ALREADY-
 *   EXISTING, not-yet-linked athletes row (e.g. Juan's, seeded before
 *   real auth came back) — preserves that row's history (workouts,
 *   Strava connection) instead of creating a duplicate athlete.
 * - Omitted: creates a brand-new athletes row from scratch, with a slug
 *   generated from the name (deduped against the current roster).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { email, name, existingAthleteId } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const db = createServiceClient();

  if (existingAthleteId) {
    const { data: existing } = await db.from("athletes").select("*").eq("id", existingAthleteId).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
    if (existing.auth_user_id) return NextResponse.json({ error: "This athlete already has an account." }, { status: 400 });

    const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${getSiteBaseUrl()}/accept-invite`,
    });
    if (inviteError || !invited?.user) {
      return NextResponse.json({ error: inviteError?.message ?? "Could not send the invite." }, { status: 500 });
    }

    const { error: updateError } = await db
      .from("athletes")
      .update({ auth_user_id: invited.user.id, email })
      .eq("id", existingAthleteId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required for a new athlete." }, { status: 400 });
  }

  const { data: roster } = await db.from("athletes").select("slug");
  const existingSlugs = new Set((roster ?? []).map((a) => a.slug));
  const slug = dedupeSlug(slugify(name), existingSlugs);

  const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getSiteBaseUrl()}/accept-invite`,
  });
  if (inviteError || !invited?.user) {
    return NextResponse.json({ error: inviteError?.message ?? "Could not send the invite." }, { status: 500 });
  }

  const { error: insertError } = await db.from("athletes").insert({
    slug,
    name,
    initials: initialsFrom(name),
    auth_user_id: invited.user.id,
    email,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
