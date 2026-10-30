"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Where an invite (or password-recovery) email link lands.
 *
 * **Primary path: `?token_hash=...&type=...`**, via `verifyOtp()` — needs
 * the Supabase email templates (Auth -> Email Templates -> "Invite user" /
 * "Reset Password") changed to link here with
 * `{{ .SiteURL }}/accept-invite?token_hash={{ .TokenHash }}&type=invite`
 * (or `type=recovery` for the reset template) instead of the default
 * `{{ .ConfirmationURL }}`. This is the one that actually works reliably:
 * found live (Oct 2026) that `{{ .ConfirmationURL }}`'s PKCE `?code=...`
 * link fails with "invalid or expired" whenever it's opened in a different
 * browser/device/tab than the one that requested it — PKCE stores a code
 * verifier in that browser's own local storage, which an email link almost
 * never gets opened back in. `verifyOtp` with a token_hash needs no stored
 * verifier, so it works from any browser Supabase's own docs recommend
 * this exact pattern for email links for that reason.
 *
 * **Fallback path: `?code=...`** (`exchangeCodeForSession()`) — kept in
 * case the email templates haven't been switched over yet, so an old-style
 * link still does *something* rather than nothing.
 *
 * Deliberately outside the AuthProvider gate (see lib/auth-context.tsx's
 * PUBLIC_PATHS) since this IS the page that creates the session in the
 * first place — gating it the same way as every other route would be
 * circular.
 */
export default function AcceptInvitePage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const rawType = params.get("type");
    const otpType = OTP_TYPES.find((t) => t === rawType);

    if (tokenHash && otpType) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType }).then(({ data, error: verifyError }) => {
        if (data.session) {
          settled = true;
          setReady(true);
          window.history.replaceState({}, "", window.location.pathname);
        } else if (verifyError) {
          console.error("verifyOtp failed", verifyError);
          setLinkError(true);
        }
      });
    }

    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error: exchangeError }) => {
        if (data.session) {
          settled = true;
          setReady(true);
          // Drop the one-time code from the URL/history now that it's used.
          window.history.replaceState({}, "", window.location.pathname);
        } else if (exchangeError) {
          console.error("exchangeCodeForSession failed", exchangeError);
          if (!tokenHash) setLinkError(true);
        }
      });
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        settled = true;
        setReady(true);
      }
    });

    // If nothing established a session within a few seconds (no code, no
    // hash, or an expired/already-used link), stop showing "Checking…"
    // forever and say so.
    const timeout = window.setTimeout(() => {
      if (!settled) setLinkError(true);
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  async function submit(e: React.FormEvent) {
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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/settings");
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

        {linkError ? (
          <p className="text-center text-sm text-error">
            {isEn
              ? "This link is invalid or has expired. Ask for a new invite or password reset."
              : "Este enlace no es válido o ya expiró. Pide una nueva invitación o recuperación de contraseña."}
          </p>
        ) : !ready ? (
          <p className="text-center text-sm text-ink-3">
            {isEn ? "Checking your invite link…" : "Verificando tu enlace de invitación…"}
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">{isEn ? "Set a password to finish setting up your account." : "Define una contraseña para terminar de crear tu cuenta."}</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-2">{isEn ? "Password" : "Contraseña"}</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-line-strong"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-2">{isEn ? "Confirm password" : "Confirmar contraseña"}</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-11 rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-line-strong"
              />
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button type="submit" disabled={saving} className="mt-2 w-full">
              {saving ? (isEn ? "Saving…" : "Guardando…") : isEn ? "Finish setup" : "Terminar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
