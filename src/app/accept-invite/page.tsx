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
/** Three distinct ways this page can fail to establish a session —
 * surfaced separately (not one generic "invalid or expired" message)
 * specifically so a real failure can be told apart from a Supabase Auth
 * email template that still links with the default `{{ .ConfirmationURL }}`
 * instead of the `?token_hash=...&type=...` pattern this page needs (see
 * CLAUDE.md's "Two live-testing bugs" section — found live reported by
 * Juan, Nov 2026, same standing unconfirmed dashboard step). */
type LinkErrorKind = "no_token" | "verify_failed" | "timeout";

export default function AcceptInvitePage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<LinkErrorKind | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isCoach, setIsCoach] = useState<"athlete" | "coach">("athlete");
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
          setLinkError("verify_failed");
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
          if (!tokenHash) setLinkError("verify_failed");
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

    // If nothing established a session within a few seconds, stop showing
    // "Checking…" forever and say so — distinguishing the two real causes
    // instead of one generic message (found live, Nov 2026, from Juan's
    // report): no token/code in the URL AT ALL almost always means the
    // Supabase email template still links with the default
    // `{{ .ConfirmationURL }}` instead of `?token_hash=...&type=...` (see
    // CLAUDE.md's "Two live-testing bugs" section) — a one-time dashboard
    // setting, not a code bug. A token/code WAS present but still failed
    // means the link itself is genuinely expired or already used.
    const timeout = window.setTimeout(() => {
      if (!settled) setLinkError(tokenHash || code ? "verify_failed" : "no_token");
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
    const { data: userData, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSaving(false);
      setError(updateError.message);
      return;
    }
    // Best-effort — a failure here shouldn't block finishing account
    // setup; is_coach is self-editable from the profile card any time
    // afterward (see CLAUDE.md's "Community" section).
    if (userData.user) {
      const { error: coachError } = await supabase
        .from("athletes")
        .update({ is_coach: isCoach === "coach" })
        .eq("auth_user_id", userData.user.id);
      if (coachError) console.error("Failed to save coach/athlete role at signup", coachError);
    }
    setSaving(false);
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

        {linkError === "no_token" ? (
          <p className="text-center text-sm text-error">
            {isEn
              ? "This page didn't receive a valid token from the link you clicked. If this keeps happening, the Supabase email template for Invite/Reset Password may still need to be updated to use token_hash (see CLAUDE.md)."
              : "Esta página no recibió un token válido del enlace que abriste. Si esto sigue pasando, puede que falte actualizar en Supabase la plantilla de correo de Invite/Reset Password para que use token_hash (ver CLAUDE.md)."}
          </p>
        ) : linkError === "verify_failed" ? (
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-2">
                {isEn ? "Are you a coach or an athlete?" : "¿Eres coach o atleta?"}
              </label>
              <p className="mb-1 text-[11px] text-ink-3">
                {isEn
                  ? "A coach can create Communities. You can change this any time from Settings."
                  : "Un coach puede crear Comunidades. Puedes cambiar esto cuando quieras desde Ajustes."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["athlete", "coach"] as const).map((v) => (
                  <label
                    key={v}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      isCoach === v ? "border-line-strong bg-ink text-bg" : "border-line text-ink-2 hover:text-ink"
                    }`}
                  >
                    <input type="radio" name="role" value={v} checked={isCoach === v} onChange={() => setIsCoach(v)} className="sr-only" />
                    {v === "athlete" ? (isEn ? "Athlete" : "Atleta") : isEn ? "Coach" : "Coach"}
                  </label>
                ))}
              </div>
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
