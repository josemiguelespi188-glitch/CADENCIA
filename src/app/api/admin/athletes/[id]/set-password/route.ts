import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Sets an athlete's password directly, with no email involved at all —
 * built specifically to unblock Juan (Nov 2026, direct request: "creame
 * un usuario para juan, con clave genérica... que haga login"), after
 * this app's invite/reset/confirm emails had repeated real delivery
 * problems the same session (Supabase's default email rate limit, then
 * an unconfirmed Resend domain). Handles both shapes:
 *
 * - The athlete already has a linked `auth_user_id` (e.g. an invite was
 *   sent and partially completed, or a password reset never landed) —
 *   `auth.admin.updateUserById()` overwrites that account's password
 *   directly and force-confirms the email, so a never-confirmed account
 *   becomes immediately usable.
 * - No `auth_user_id` yet — creates a brand-new, already-confirmed auth
 *   user via `auth.admin.createUser()` (using the athlete's own stored
 *   `email`, which must already be set) and links it to this athletes
 *   row, same linking this app's invite flow already does.
 *
 * Either way, no Supabase email is sent — the admin hands the chosen
 * password to the athlete directly, out of band.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await params;
  const { password } = await req.json().catch(() => ({}));
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: athlete } = await db.from("athletes").select("*").eq("id", id).maybeSingle();
  if (!athlete) return NextResponse.json({ error: "Athlete not found." }, { status: 404 });

  if (athlete.auth_user_id) {
    const { error } = await db.auth.admin.updateUserById(athlete.auth_user_id, { password, email_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!athlete.email) {
    return NextResponse.json({ error: "This athlete has no email on file — add one first." }, { status: 400 });
  }

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: athlete.email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return NextResponse.json({ error: createError?.message ?? "Could not create the account." }, { status: 500 });
  }

  const { error: linkError } = await db.from("athletes").update({ auth_user_id: created.user.id }).eq("id", id);
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
