"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import type { Athlete } from "@/lib/types";

/** Routes reachable with no session — only the one page that CREATES a
 * session from an invite/recovery email link. Checked by prefix since
 * Next route params aren't known statically here. */
const PUBLIC_PATHS = [
  "/accept-invite",
  // Needs to be reachable with no account — e.g. for Garmin/COROS API
  // application reviewers to read it, per the "Garmin Personal API"
  // section in CLAUDE.md.
  "/privacy",
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
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

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

  useEffect(() => {
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAthletes();
    } else {
      setAthletes([]);
    }
  }, [session, loadAthletes]);

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
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [resetSent, setResetSent] = useState(false);

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

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <TextField id="email" label={isEn ? "Email" : "Correo"} type="email" value={email} onChange={setEmail} />
            <TextField id="password" label={isEn ? "Password" : "Contraseña"} type="password" value={password} onChange={setPassword} />
            {error && <p className="text-sm text-error">{error}</p>}
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
            {error && <p className="text-sm text-error">{error}</p>}
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
            ? "No self sign-up. Ask an admin to invite you."
            : "No hay registro abierto. Pide a un admin que te invite."}
        </p>
      </div>
    </div>
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
