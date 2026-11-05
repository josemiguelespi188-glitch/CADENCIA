import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureAthleteForUser } from "@/lib/ensureAthlete";

/**
 * Called right after a successful self-registration on `/` (see that
 * page's own header comment) when `signUp()` returns an immediate
 * session — ensures an `athletes` row exists for this brand-new account,
 * reusing the exact same idempotent logic Google's self-registration
 * already relies on (`ensureAthleteForUser`), so both paths create a new
 * athlete identically rather than duplicating that logic.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    await ensureAthleteForUser(user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("ensureAthleteForUser failed (self-registration)", e);
    return NextResponse.json({ error: "Could not finish creating your account." }, { status: 500 });
  }
}
