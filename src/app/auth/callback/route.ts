import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureAthleteForUser } from "@/lib/ensureAthlete";

/**
 * Where Supabase sends the browser back after Google's own OAuth consent
 * screen (Google itself redirects to Supabase's hosted callback first,
 * `https://<project-ref>.supabase.co/auth/v1/callback`, registered in
 * Google Cloud Console — NOT this route; Supabase then forwards here,
 * to the `redirectTo` passed to `signInWithOAuth`, with a `?code=...` PKCE
 * code this app exchanges for its own session cookie). See CLAUDE.md's
 * "Google sign-in" section for the full manual setup steps.
 *
 * On a brand-new Google account, this is also where the athlete row gets
 * auto-created — see ensureAthleteForUser's own doc comment for why.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      try {
        await ensureAthleteForUser(data.user);
        return NextResponse.redirect(`${origin}${next}`);
      } catch (e) {
        // ensureAthleteForUser now throws on a genuine (non-duplicate)
        // failure to create the athlete row — route to the existing
        // error path instead of an unhandled 500.
        console.error("ensureAthleteForUser failed", e);
      }
    }
  }

  return NextResponse.redirect(`${origin}/calendar?auth_error=1`);
}
