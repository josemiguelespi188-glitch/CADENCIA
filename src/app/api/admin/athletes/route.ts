import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Full roster for /admin — includes email/is_admin/auth_user_id, which the
 * regular authenticated `athletes` select policy also exposes (every
 * signed-in athlete can already see every other's basic row, per the open
 * "Friends" model — see CLAUDE.md), but this goes through the service-role
 * client anyway since it's gated on admin, not on being signed in at all. */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const db = createServiceClient();
  const { data, error } = await db.from("athletes").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ athletes: data ?? [] });
}
