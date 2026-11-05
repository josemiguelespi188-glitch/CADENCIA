"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import type { Athlete } from "@/lib/types";

/** Routes reachable with no session — checked by prefix since Next route
 * params aren't known statically here. Does NOT include "/" (the public
 * home/registration page, Nov 2026) — a prefix check on "/" would match
 * every path in the app and defeat the whole gate, so root is matched
 * exactly instead, right where this list is used below. */
const PUBLIC_PATHS = [
  "/accept-invite",
  // Needs to be reachable with no account — e.g. for Garmin/COROS API
  // application reviewers to read it, per the "Garmin Personal API"
  // section in CLAUDE.md.
  "/privacy",
  // The actual self-registration form, linked from "/"'s landing page.
  "/register",
];

interface AuthCtx {
  session: Session | null;
  /** The signed-in user's own athletes row. Null until resolved, or if
   * this auth user has no linked row yet (shouldn't happen via the normal
   * invite flow, but fails safe rather than crashing). */
  me: Athlete | null;
  /** Every athlete in the roster — for the Friends picker and any
   * slug -> name/initials lookup (replaces the old hardcoded ATHLETES
   * constant now that the roster is dynamic). */
  athletes: Athlete[];
  athleteBySlug: Record<string, Athlete>;
  /** Whose calendar/dashboard is currently shown — a single-slug array
   * (not a merged multi-select; see `viewAthlete` below), defaulting to
   * your own once resolved. */
  viewing: string[];
  /** Always `false` now that `viewing` is single-select — kept rather
   * than ripped out across every file that still reads it (same "left
   * in place since harmless, may get a future non-single caller"
   * reasoning this codebase already applies to `Stepper`'s unreachable
   * canceled-steps handling). */
  isMultiple: boolean;
  /** Switches whose week is shown — replaces your own view with this
   * athlete's entirely, never merges the two (Nov 2026, direct
   * feedback: "no me gusta que se haga merge con sus actividades mi
   * calendario... que sea mas view my friends week" — the old
   * multi-select "Friends" checkbox list that merged several athletes'
   * workouts onto one calendar moved to Community instead, see
   * CLAUDE.md). */
  viewAthlete: (slug: string) => void;
  /** Re-fetches the roster — call after inviting someone or editing your
   * own profile's name, so the UI reflects it without a full reload. */
  refreshAthletes: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

/** The one path exempt from the onboarding redirect below (besides the
 * public paths, which never reach this check at all) — everything else
 * a not-yet-onboarded athlete tries to visit bounces back to
 * `/onboarding` first, per explicit instruction that filling the
 * profile + connecting accounts is "lo primero que tiene que hacer." */
const ONBOARDING_PATH = "/onboarding";

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = pathname === "/" || PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  // Separate from `athletes.length > 0` — a brand-new account with a
  // real session but a genuinely missing/not-yet-created athletes row
  // (found live, Nov 2026: the Settings page's "Loading…" never
  // resolved, and the header's nav stayed fully clickable the whole
  // time since it doesn't check onboarding state at all) needs its own
  // "the fetch finished, there's really nothing here" state, distinct
  // from "still fetching."
  const [athletesLoaded, setAthletesLoaded] = useState(false);
  const [viewing, setViewing] = useState<string[]>([]);
  // Real race found live (Nov 2026, reported with a fresh never-before-
  // seen account, not a stale session): `supabase.auth.signUp()` fires
  // this provider's `onAuthStateChange` listener the instant the new
  // session is set, which kicks off `loadAthletes()` immediately — but
  // the caller (`/register`, Google's callback, `/accept-invite`) only
  // creates the matching `athletes` row in a SEPARATE request
  // (`ensureAthleteForUser()`) that's still in flight at that exact
  // moment. `loadAthletes()` wins the race, finds nothing, and since
  // `userId` never changes afterward, the `athletes` array in state is
  // never refetched — `me` stays null forever even though the row shows
  // up in the database a moment later. Retrying a few times before
  // concluding "no profile" closes this for every entry path at once,
  // instead of patching each one to call `refreshAthletes()` itself.
  const [noProfileRetries, setNoProfileRetries] = useState(0);
  const MAX_NO_PROFILE_RETRIES = 6;

  const loadAthletes = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.from("athletes").select("*").order("name");
    if (error) console.error("Failed to load athletes", error);
    setAthletes((data as Athlete[]) ?? []);
    setAthletesLoaded(true);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Found live (Nov 2026, full codebase audit): this used to depend on
  // the whole `session` object, which gets a brand-new reference on
  // every Supabase token auto-refresh (roughly hourly) — each one fired
  // this effect and re-queried the full athletes table for every open
  // tab with nothing actually changed. Depends on the user id (a
  // stable string) instead, so it only re-fires on a real sign-in/
  // sign-out, not a background token refresh.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAthletes();
      setNoProfileRetries(0);
    } else {
      setAthletes([]);
      setAthletesLoaded(false);
    }
  }, [userId, loadAthletes]);

  const me = useMemo(() => {
    if (!session) return null;
    return athletes.find((a) => a.auth_user_id === session.user.id) ?? null;
  }, [session, athletes]);

  // Bounded retry: a session resolved, the athletes fetch finished, but
  // no row matched yet. Could be the ensure-athlete race described above
  // (the row is about to appear), or a real athletes row that already
  // exists under this email but is unlinked (`auth_user_id` null — e.g.
  // after deleting and re-creating a Supabase Auth user for the same
  // email, found live Nov 2026). Every retry also re-POSTs to
  // `/api/auth/ensure-athlete` (idempotent — creates the row if it's
  // genuinely missing, or re-links an existing-but-unlinked one per the
  // fix in `ensureAthleteForUser`, or no-ops if already correctly
  // linked) before refetching, so both cases self-heal here with no
  // manual sign-out/sign-in needed. Only falls through to a real
  // "genuinely orphaned" NoProfileScreen once every retry — including
  // its own self-heal attempt — has failed to produce a match.
  useEffect(() => {
    if (!session || !athletesLoaded || me || noProfileRetries >= MAX_NO_PROFILE_RETRIES) return;
    const t = setTimeout(() => {
      fetch("/api/auth/ensure-athlete", { method: "POST" })
        .catch(() => {})
        .finally(() => {
          setNoProfileRetries((n) => n + 1);
          loadAthletes();
        });
    }, 600);
    return () => clearTimeout(t);
  }, [session, athletesLoaded, me, noProfileRetries, loadAthletes]);

  const athleteBySlug = useMemo(() => Object.fromEntries(athletes.map((a) => [a.slug, a])), [athletes]);

  // First-run onboarding gate (Nov 2026) — any signed-in athlete whose
  // profile row isn't marked onboarding_completed yet gets bounced to
  // /onboarding before seeing anything else, regardless of how their
  // account was created (self-registration, Google, or an admin
  // invite). `me` is still null for a brief moment right after sign-in
  // while `athletes` is loading, so this only fires once it's actually
  // resolved — never redirects a half-loaded session.
  const needsOnboarding = !!me && !me.onboarding_completed && pathname !== ONBOARDING_PATH;
  useEffect(() => {
    if (needsOnboarding) router.replace(ONBOARDING_PATH);
  }, [needsOnboarding, router]);

  // Auto-sync Strava on login (Nov 2026, direct instruction: "Cada vez
  // que se hace log in a la plataforma debería pushear a strava los
  // comments a descriptions de la actividad"). Fires once per real
  // session establishment — keyed on `userId` (not on every client-side
  // route change, since that never changes `userId`) — once the
  // onboarding gate has cleared, so it never fires mid-onboarding before
  // the athlete has had a chance to connect anything. Best-effort and
  // silent either way: `/api/strava/sync` already no-ops for an athlete
  // with no Strava connection (the common case for most logins), and
  // the same route already does the real work this exists to trigger —
  // matching a planned workout's own `strava_comment` (or an
  // AI-drafted one) onto the Strava activity's description, see
  // CLAUDE.md's "Strava integration" section.
  useEffect(() => {
    if (!userId || needsOnboarding) return;
    fetch("/api/strava/sync", { method: "POST" }).catch(() => {});
  }, [userId, needsOnboarding]);

  useEffect(() => {
    if (!me) return;
    try {
      const saved = JSON.parse(localStorage.getItem("cadencia-viewing") ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewing(Array.isArray(saved) && saved.length === 1 && typeof saved[0] === "string" ? saved : [me.slug]);
    } catch {
      setViewing([me.slug]);
    }
  }, [me]);

  function viewAthlete(slug: string) {
    setViewing([slug]);
    try {
      localStorage.setItem("cadencia-viewing", JSON.stringify([slug]));
    } catch {
      /* ignore */
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Direct instruction (Nov 2026): land back on the public marketing
    // page, not the gated sign-in screen — every Sign Out button in the
    // app (Settings, NoProfileScreen) goes through this one function, so
    // fixing it here covers all of them.
    router.push("/");
  }

  const value: AuthCtx = {
    session,
    me,
    athletes,
    athleteBySlug,
    viewing,
    isMultiple: viewing.length > 1,
    viewAthlete,
    refreshAthletes: loadAthletes,
    signOut,
  };

  if (isPublicPath) {
    // The invite/recovery-accept page creates its own session from the
    // email link — it can't be behind this same gate.
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  if (sessionLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg" />;
  }

  if (!session) {
    return (
      <Ctx.Provider value={value}>
        <SignInScreen />
      </Ctx.Provider>
    );
  }

  // A session exists but the athletes fetch hasn't finished yet — show a
  // blank loading state, not `children` (which would render whatever
  // page's own nav/header with nothing to gate against yet). Once this
  // flips to true with `me` still null, that's a REAL problem (a session
  // with no matching athletes row), handled by the next block instead of
  // silently falling through to an infinite per-page "Loading…".
  if (!athletesLoaded) {
    return <Ctx.Provider value={value}><div className="flex min-h-screen items-center justify-center bg-bg" /></Ctx.Provider>;
  }

  if (!me) {
    if (noProfileRetries < MAX_NO_PROFILE_RETRIES) {
      // Still retrying — this is almost always the ensure-athlete race
      // described above resolving itself within a second or two, not a
      // real problem yet.
      return <Ctx.Provider value={value}><div className="flex min-h-screen items-center justify-center bg-bg" /></Ctx.Provider>;
    }
    return <Ctx.Provider value={value}><NoProfileScreen signOut={signOut} /></Ctx.Provider>;
  }

  if (needsOnboarding) {
    // Avoid flashing the real destination page's content (including its
    // own nav — direct complaint, Nov 2026: "que no te deje aplastar en
    // calendar, community o generate") for the one tick before the
    // redirect effect above fires.
    return <Ctx.Provider value={value}><div className="flex min-h-screen items-center justify-center bg-bg" /></Ctx.Provider>;
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** A real session exists but no `athletes` row links to it — shown
 * instead of letting every page sit on its own infinite "Loading…"
 * forever with the full nav still clickable underneath (found live,
 * Nov 2026). Gives the one real recourse available: sign out and try
 * again (e.g. a fresh invite/registration whose athlete-row creation
 * failed partway). */
function NoProfileScreen({ signOut }: { signOut: () => Promise<void> }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <span
        className="text-2xl font-black tracking-[0.05em] text-ink"
        style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
      >
        cadencia
      </span>
      <p className="max-w-sm text-sm text-ink-2">
        {isEn
          ? "We couldn't find a profile linked to your account. Try signing out and signing back in — if this keeps happening, ask an admin for help."
          : "No encontramos un perfil vinculado a tu cuenta. Intenta cerrar sesión y volver a entrar — si esto sigue pasando, pide ayuda a un admin."}
      </p>
      <Button variant="outline" onClick={signOut}>
        {isEn ? "Sign out" : "Cerrar sesión"}
      </Button>
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Every page now requires a real account — there's no self sign-up
 * (per explicit product decision, Oct 2026, re-enabling auth after a
 * period of being off — see CLAUDE.md's "Real auth + admin" section).
 * New accounts are created only through /admin's invite flow.
 */
function SignInScreen() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth_error") === "1") {
      setError(isEn ? "Could not sign in with Google. Try again." : "No se pudo iniciar sesión con Google. Intenta de nuevo.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Found live (Nov 2026, from a real screenshot): Google was never
  // actually enabled in Supabase's own Auth providers — clicking this
  // navigated the whole page away to Supabase's raw authorize endpoint,
  // which then showed its own unbranded
  // {"code":400,"error_code":"validation_failed","msg":"Unsupported
  // provider: provider is not enabled"} JSON. That's a full top-level
  // navigation, so there's no way to catch the failure and show a nice
  // in-app message after the fact — the only honest fix is not starting
  // it at all until the Supabase side is really configured, same
  // disabled-with-a-note treatment `/register`'s own Google button
  // already uses. `signInWithOAuth` is deliberately NOT called here
  // anymore; flip this back to the real call once Google is confirmed
  // enabled in Supabase Auth -> Providers.

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(isEn ? "Could not sign in. Check your email and password." : "No se pudo iniciar sesión. Revisa tu correo y contraseña.");
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/accept-invite`,
    });
    setLoading(false);
    if (resetError) {
      setError(isEn ? "Could not send the reset email." : "No se pudo enviar el correo de recuperación.");
    } else {
      setResetSent(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            className="text-2xl font-black tracking-[0.05em] text-ink"
            style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
          >
            cadencia
          </span>
          <p className="mt-1 text-[10px] uppercase tracking-[0.5em] text-ink-3">{isEn ? "training log" : "registro de entreno"}</p>
        </div>

        <button
          type="button"
          disabled
          title={isEn ? "Not available yet" : "Aún no disponible"}
          className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 text-sm font-medium text-ink-3"
        >
          <GoogleIcon />
          {isEn ? "Continue with Google (not available yet)" : "Continuar con Google (aún no disponible)"}
        </button>
        {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

        {mode === "signin" && (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-ink-3">{isEn ? "or" : "o"}</span>
            <div className="h-px flex-1 bg-line" />
          </div>
        )}

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <TextField id="email" label={isEn ? "Email" : "Correo"} type="email" value={email} onChange={setEmail} />
            <TextField id="password" label={isEn ? "Password" : "Contraseña"} type="password" value={password} onChange={setPassword} />
            <Button type="submit" disabled={loading} className="mt-2 w-full">
              {loading ? (isEn ? "Signing in…" : "Entrando…") : isEn ? "Sign In" : "Iniciar Sesión"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode("reset");
                setError(null);
              }}
              className="text-center text-xs text-ink-3 hover:text-ink"
            >
              {isEn ? "Forgot your password?" : "¿Olvidaste tu contraseña?"}
            </button>
          </form>
        ) : resetSent ? (
          <p className="text-center text-sm text-ink-2">
            {isEn ? `Check ${email} for a password reset link.` : `Revisa ${email} para el enlace de recuperación.`}
          </p>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            <TextField id="reset-email" label={isEn ? "Email" : "Correo"} type="email" value={email} onChange={setEmail} />
            <Button type="submit" disabled={loading} className="mt-2 w-full">
              {loading ? (isEn ? "Sending…" : "Enviando…") : isEn ? "Send reset link" : "Enviar enlace"}
            </Button>
            <button type="button" onClick={() => setMode("signin")} className="text-center text-xs text-ink-3 hover:text-ink">
              {isEn ? "Back to sign in" : "Volver a iniciar sesión"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-ink-3">
          {isEn ? "New here? " : "¿Primera vez? "}
          <a href="/register" className="underline hover:text-ink">
            {isEn ? "Create an account" : "Crea una cuenta"}
          </a>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.6H24v8.7h11.9c-.5 2.8-2.1 5.1-4.5 6.7v5.5h7.3c4.3-3.9 6.8-9.7 6.8-16.3z"
      />
      <path
        fill="#34A853"
        d="M24 46c6.1 0 11.3-2 15-5.5l-7.3-5.5c-2 1.4-4.6 2.2-7.7 2.2-5.9 0-10.9-4-12.7-9.4H3.7v5.7C7.4 41 15 46 24 46z"
      />
      <path fill="#FBBC05" d="M11.3 27.8c-.5-1.4-.7-2.8-.7-4.3s.3-3 .7-4.3v-5.7H3.7C2.6 16.2 2 20 2 23.5s.6 7.3 1.7 10l7.6-5.7z" />
      <path
        fill="#EA4335"
        d="M24 10.8c3.3 0 6.3 1.1 8.6 3.3l6.5-6.3C35.3 4.1 30.1 2 24 2 15 2 7.4 7 3.7 13.8l7.6 5.7c1.8-5.4 6.8-9.4 12.7-9.4z"
      />
    </svg>
  );
}

function TextField({
  id,
  label,
  type,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
      />
    </div>
  );
}
