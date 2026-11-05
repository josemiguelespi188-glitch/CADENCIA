"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * The actual registration form — moved here from `/` (Nov 2026, direct
 * follow-up: "quiero que haya una landing page explicativa" before the
 * sign-up form itself). `/` is now a real marketing landing page; this is
 * where its "Sign Up"/"Get Started" buttons lead. See `/page.tsx`'s own
 * header comment for the registration-method decisions (plain
 * email+password active, Google shown disabled) — unchanged here, just
 * relocated with a shorter intro since the landing page already carries
 * the full pitch.
 */
export default function RegisterPage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/calendar");
      } else {
        setCheckingSession(false);
      }
    });
  }, [router]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(isEn ? "Password must be at least 8 characters." : "La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError(isEn ? "Passwords don't match." : "Las contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/accept-invite` },
    });
    if (signUpError) {
      setSaving(false);
      setError(signUpError.message);
      return;
    }
    if (data.session) {
      // Supabase's "Confirm email" is off (or this project otherwise
      // auto-confirms) — the account is real and signed in immediately.
      // Ensure the athletes row exists, same idempotent path Google's
      // self-registration already uses, before entering the app.
      const res = await fetch("/api/auth/ensure-athlete", { method: "POST" });
      if (!res.ok) {
        setSaving(false);
        setError(isEn ? "Account created, but setting up your profile failed. Try signing in." : "Se creó la cuenta, pero falló configurar tu perfil. Intenta iniciar sesión.");
        return;
      }
      router.push("/settings");
      return;
    }
    setSaving(false);
    setPendingConfirmation(true);
  }

  if (checkingSession) return <div className="flex min-h-screen items-center justify-center bg-bg" />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center">
          <span
            className="text-2xl font-black tracking-[0.05em] text-ink"
            style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
          >
            cadencia
          </span>
          <p className="mt-1 text-[10px] uppercase tracking-[0.5em] text-ink-3">{isEn ? "training log" : "registro de entreno"}</p>
        </Link>

        {pendingConfirmation ? (
          <p className="text-center text-sm text-ink-2">
            {isEn
              ? `Check ${email} for a confirmation link to finish creating your account.`
              : `Revisa ${email} para un enlace de confirmación y terminar de crear tu cuenta.`}
          </p>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-ink-2">{isEn ? "Create your account" : "Crea tu cuenta"}</p>

            <button
              type="button"
              disabled
              title={isEn ? "Not available yet" : "Aún no disponible"}
              className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 text-sm font-medium text-ink-3"
            >
              <GoogleIcon />
              {isEn ? "Continue with Google (not available yet)" : "Continuar con Google (aún no disponible)"}
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-ink-3">{isEn ? "or" : "o"}</span>
              <div className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              <TextField id="reg-email" label="Email" type="email" value={email} onChange={setEmail} />
              <TextField id="reg-password" label={isEn ? "Password" : "Contraseña"} type="password" value={password} onChange={setPassword} />
              <TextField id="reg-confirm" label={isEn ? "Confirm password" : "Confirmar contraseña"} type="password" value={confirm} onChange={setConfirm} />
              {error && <p className="text-sm text-error">{error}</p>}
              <Button type="submit" disabled={saving} className="mt-2 w-full">
                {saving ? (isEn ? "Creating account…" : "Creando cuenta…") : isEn ? "Create account" : "Crear cuenta"}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-ink-3">
              {isEn ? "Already have an account? " : "¿Ya tienes cuenta? "}
              <a href="/calendar" className="underline hover:text-ink">
                {isEn ? "Sign in" : "Inicia sesión"}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.6H24v8.7h11.9c-.5 2.8-2.1 5.1-4.5 6.7v5.5h7.3c4.3-3.9 6.8-9.7 6.8-16.3z" />
      <path fill="#34A853" d="M24 46c6.1 0 11.3-2 15-5.5l-7.3-5.5c-2 1.4-4.6 2.2-7.7 2.2-5.9 0-10.9-4-12.7-9.4H3.7v5.7C7.4 41 15 46 24 46z" />
      <path fill="#FBBC05" d="M11.3 27.8c-.5-1.4-.7-2.8-.7-4.3s.3-3 .7-4.3v-5.7H3.7C2.6 16.2 2 20 2 23.5s.6 7.3 1.7 10l7.6-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.3 1.1 8.6 3.3l6.5-6.3C35.3 4.1 30.1 2 24 2 15 2 7.4 7 3.7 13.8l7.6 5.7c1.8-5.4 6.8-9.4 12.7-9.4z" />
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
