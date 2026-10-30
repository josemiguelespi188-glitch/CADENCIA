import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Toggles is_admin on an athlete row. Uses the service-role client — the
 * only path allowed to change this column at all, see the
 * athletes_guard_is_admin trigger (migration 013) that blocks every other
 * write path, including an admin's own session client. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await params;
  const { isAdmin } = await req.json().catch(() => ({}));
  if (typeof isAdmin !== "boolean") {
    return NextResponse.json({ error: "isAdmin must be a boolean." }, { status: 400 });
  }

  const db = createServiceClient();

  if (!isAdmin) {
    // Refuse to leave the roster with zero admins — would lock everyone
    // out of /admin with no way back in short of a manual SQL edit.
    const { count } = await db.from("athletes").select("id", { count: "exact", head: true }).eq("is_admin", true);
    const { data: target } = await db.from("athletes").select("is_admin").eq("id", id).maybeSingle();
    if (target?.is_admin && (count ?? 0) <= 1) {
      return NextResponse.json({ error: "Can't remove the last admin." }, { status: 400 });
    }
  }

  const { error } = await db.from("athletes").update({ is_admin: isAdmin }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
