"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
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
  /** Slugs currently shown on the calendar/dashboard — always includes
   * your own once resolved. "Friends" toggles other slugs in and out. */
  viewing: string[];
  isMultiple: boolean;
  toggleFriend: (slug: string) => void;
  /** Re-fetches the roster — call after inviting someone or editing your
   * own profile's name, so the UI reflects it without a full reload. */
  refreshAthletes: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublicPath = pathname === "/" || PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [viewing, setViewing] = useState<string[]>([]);

  const loadAthletes = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("athletes").select("*").order("name");
    setAthletes((data as Athlete[]) ?? []);
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
    } else {
      setAthletes([]);
    }
  }, [userId, loadAthletes]);

  const me = useMemo(() => {
    if (!session) return null;
    return athletes.find((a) => a.auth_user_id === session.user.id) ?? null;
  }, [session, athletes]);

  const athleteBySlug = useMemo(() => Object.fromEntries(athletes.map((a) => [a.slug, a])), [athletes]);

  useEffect(() => {
    if (!me) return;
    try {
      const saved = JSON.parse(localStorage.getItem("cadencia-viewing") ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewing(Array.isArray(saved) && saved.includes(me.slug) ? saved : [me.slug]);
    } catch {
      setViewing([me.slug]);
    }
  }, [me]);

  function toggleFriend(slug: string) {
    if (!me) return;
    setViewing((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      const withMe = next.includes(me.slug) ? next : [me.slug, ...next];
      try {
        localStorage.setItem("cadencia-viewing", JSON.stringify(withMe));
      } catch {
        /* ignore */
      }
      return withMe;
    });
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  const value: AuthCtx = {
    session,
    me,
    athletes,
    athleteBySlug,
    viewing,
    isMultiple: viewing.length > 1,
    toggleFriend,
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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth_error") === "1") {
      setError(isEn ? "Could not sign in with Google. Try again." : "No se pudo iniciar sesión con Google. Intenta de nuevo.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setGoogleLoading(false);
      setError(isEn ? "Could not start Google sign-in." : "No se pudo iniciar sesión con Google.");
    }
    // On success the browser navigates away to Google — no need to clear loading.
  }

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
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink transition-colors hover:border-line-strong disabled:opacity-60"
        >
          <GoogleIcon />
          {googleLoading ? (isEn ? "Redirecting…" : "Redirigiendo…") : isEn ? "Continue with Google" : "Continuar con Google"}
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
          {isEn
            ? "New here? Sign in with Google and your account is created automatically."
            : "¿Primera vez? Inicia sesión con Google y tu cuenta se crea automáticamente."}
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
