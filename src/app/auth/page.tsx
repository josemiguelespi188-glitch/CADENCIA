"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function AuthPage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(
        isEn
          ? "Could not sign in. Check your email and password."
          : "No se pudo iniciar sesión. Revisa tu correo y contraseña."
      );
      return;
    }
    router.push("/calendar");
    router.refresh();
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
          <p className="mt-1 text-[10px] uppercase tracking-[0.5em] text-ink-3">
            {isEn ? "training log" : "registro de entreno"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs text-ink-2">
              {isEn ? "Email" : "Correo"}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs text-ink-2">
              {isEn ? "Password" : "Contraseña"}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" disabled={loading} className="mt-2 w-full">
            {loading ? (isEn ? "Signing in…" : "Entrando…") : isEn ? "Sign In" : "Iniciar Sesión"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-3">
          {isEn
            ? "Accounts are created by hand for Juan and José — there's no self sign-up."
            : "Las cuentas se crean a mano para Juan y José — no hay registro abierto."}
        </p>
      </div>
    </div>
  );
}
