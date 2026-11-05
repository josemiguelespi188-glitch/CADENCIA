import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Global, admin-editable "guardrail" instructions appended to every AI
 * generation call (the "Generate with AI" box and the automatic Strava
 * description write-back) — direct request: "se puede crear un prompt
 * guardrails instruction section para modificar lo que busca el ai?
 * Sería bueno para que venga todo en ingles y con una estructura." See
 * CLAUDE.md's "AI access control" section. A single row in `ai_settings`
 * (service-role only), read via `lib/aiAccess.ts`'s `getAiInstructions()`.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const db = createServiceClient();
  const { data, error } = await db.from("ai_settings").select("instructions, updated_at").eq("id", true).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ instructions: data?.instructions ?? "", updatedAt: data?.updated_at ?? null });
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { instructions } = await req.json().catch(() => ({}));
  if (typeof instructions !== "string") {
    return NextResponse.json({ error: "instructions must be a string." }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db
    .from("ai_settings")
    .upsert({ id: true, instructions, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
