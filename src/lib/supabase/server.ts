import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Server-side Supabase client for use in Server Components, Route Handlers, and Server Actions. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component without a writable cookie store — safe to ignore
            // when middleware is refreshing the session.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS entirely. Server-only (route handlers),
 * never imported into client components. Used for the Strava OAuth
 * callback/sync routes, which write tokens and synced activities on behalf
 * of whichever athlete is authorizing, independent of the signed-in
 * session's own RLS-scoped access.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createPlainClient(url, key, { auth: { persistSession: false } });
}
