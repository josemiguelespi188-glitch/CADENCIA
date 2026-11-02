import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { validateGarminPersonalKey } from "@/lib/integrations/garmin";

/**
 * Saves the SIGNED-IN athlete's own Garmin Personal API key — never
 * another athlete's, unlike COROS's workout push (see CLAUDE.md): this
 * is explicitly "your own key for your own data," per Garmin's stated
 * terms for this API tier. Validates the key live (a real token
 * exchange) before storing it, so a typo'd or already-expired key is
 * rejected immediately with a clear error instead of silently stored.
 */
export async function POST(req: NextRequest) {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { apiKey } = await req.json().catch(() => ({}));
  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "A Garmin Personal API key is required." }, { status: 400 });
  }

  try {
    await validateGarminPersonalKey(apiKey);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not validate this key." }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db
    .from("garmin_connections")
    .upsert(
      { athlete_id: athlete.id, personal_api_key: apiKey, access_token: null, access_token_expires_at: null, connected_at: new Date().toISOString() },
      { onConflict: "athlete_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
