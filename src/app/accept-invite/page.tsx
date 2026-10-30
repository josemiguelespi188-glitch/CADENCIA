"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Where an invite (or password-recovery) email link lands. Supabase's
 * browser client auto-detects the session from the URL hash on load
 * (`detectSessionInUrl`, on by default) — this page just waits for that,
 * then finishes by setting a real password. Deliberately outside the
 * AuthProvider gate (see lib/auth-context.tsx's PUBLIC_PATHS) since this
 * IS the page that creates the session in the first place — gating it
 * the same way as every other route would be circular.
 */
export default function AcceptInvitePage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
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

        {!ready ? (
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
