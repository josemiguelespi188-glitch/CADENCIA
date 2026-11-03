import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { revokeWhoopAccess } from "@/lib/integrations/whoop";

/** Revokes on WHOOP's own side (best-effort) before deleting the local row —
 * see revokeWhoopAccess()'s own doc comment. */
export async function POST() {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = createServiceClient();
  const { data: conn } = await db.from("whoop_connections").select("access_token").eq("athlete_id", athlete.id).maybeSingle();
  if (conn?.access_token) await revokeWhoopAccess(conn.access_token);

  const { error } = await db.from("whoop_connections").delete().eq("athlete_id", athlete.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
