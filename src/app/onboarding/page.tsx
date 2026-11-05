"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AthleteProfileCard } from "@/components/AthleteProfileCard";
import { AthleteCorosCard, AthleteGarminCard, AthleteGarminDevCard, AthleteStravaCard, AthleteWhoopCard, AthleteZonesCard } from "@/components/settings/ConnectionCards";

/**
 * First-run onboarding wizard (Nov 2026, direct, verbatim instruction
 * after self-registration shipped: "cuando entro debería hacerme llenar
 * todo el perfil de como encuesta y pedirme que me conecte con los
 * diferentes apis. eso es lo primero que tiene que hacer"). Gated by
 * `athletes.onboarding_completed` (migration 035) — `AuthProvider` in
 * `lib/auth-context.tsx` redirects here on every page load until it's
 * marked true, for ANY brand-new account regardless of how it signed up
 * (self-registration via `/register`, Google, or an admin invite via
 * `/accept-invite`) — existing accounts (Juan, José) were backfilled to
 * already-done so this doesn't suddenly interrupt them.
 *
 * Two steps, reusing the exact same components `/settings` already has
 * (extracted into `components/settings/ConnectionCards.tsx` specifically
 * so this page and `/settings` share one implementation, not two):
 *
 * 1. **Profile** (`AthleteProfileCard` + `AthleteZonesCard`) —
 *    deliberately NOT skippable, since filling this in needs nothing
 *    external and the user asked for "todo el perfil" directly.
 * 2. **Connections** (the 5 integration cards) — has a "Skip for now"
 *    option, since connecting a real Strava/WHOOP/Garmin/COROS account
 *    isn't something this app can force (the athlete may not have one
 *    yet) — skipping still marks onboarding complete so it doesn't nag
 *    forever; everything here stays editable from `/settings` any time.
 */
export default function OnboardingPage() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const router = useRouter();
  const { me, refreshAthletes } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    if (!me) return;
    setFinishing(true);
    const supabase = createClient();
    await supabase.from("athletes").update({ onboarding_completed: true }).eq("id", me.id);
    await refreshAthletes();
    router.push("/calendar");
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <main className="flex-1 px-6 pt-16 pb-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 text-center">
            <span
              className="text-2xl font-black tracking-[0.05em] text-ink"
              style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
            >
              cadencia
            </span>
            <p className="mt-1 text-[10px] uppercase tracking-[0.5em] text-ink-3">{isEn ? "let's get set up" : "vamos a configurar todo"}</p>
          </div>

          <div className="mx-auto mb-10 flex max-w-xs items-center gap-3">
            <StepDot active={step === 1} done={step > 1} label={isEn ? "Profile" : "Perfil"} />
            <div className="h-px flex-1 bg-line" />
            <StepDot active={step === 2} done={false} label={isEn ? "Connections" : "Conexiones"} />
          </div>

          {!me ? (
            <p className="text-center text-ink-3">{isEn ? "Loading…" : "Cargando…"}</p>
          ) : step === 1 ? (
            <div>
              <h1 className="mb-1 text-xl font-semibold tracking-tight">{isEn ? "Tell us about yourself" : "Cuéntanos de ti"}</h1>
              <p className="mb-6 text-sm text-ink-2">
                {isEn
                  ? "This fills your athlete profile and training zones — you can always edit it later from Settings."
                  : "Esto llena tu perfil de atleta y tus zonas de entrenamiento — siempre puedes editarlo después desde Ajustes."}
              </p>
              <AthleteProfileCard slug={me.slug} />
              <div className="mt-8">
                <AthleteZonesCard slug={me.slug} />
              </div>
              <div className="mt-8 flex justify-end">
                <Button onClick={() => setStep(2)}>{isEn ? "Continue" : "Continuar"}</Button>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="mb-1 text-xl font-semibold tracking-tight">{isEn ? "Connect your accounts" : "Conecta tus cuentas"}</h1>
              <p className="mb-6 text-sm text-ink-2">
                {isEn
                  ? "Sync real data from whatever you actually use — none of this is required, connect only what applies to you."
                  : "Sincroniza datos reales de lo que realmente uses — nada de esto es obligatorio, conecta solo lo que aplique."}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AthleteStravaCard />
                <AthleteWhoopCard />
                <AthleteGarminDevCard />
                <AthleteCorosCard />
                <AthleteGarminCard />
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  {isEn ? "Back" : "Atrás"}
                </Button>
                <div className="flex items-center gap-3">
                  <button onClick={finish} disabled={finishing} className="text-xs text-ink-3 underline hover:text-ink disabled:opacity-50">
                    {isEn ? "Skip for now" : "Omitir por ahora"}
                  </button>
                  <Button onClick={finish} disabled={finishing}>
                    {finishing ? (isEn ? "Finishing…" : "Terminando…") : isEn ? "Finish" : "Terminar"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          background: active || done ? "var(--ink)" : "var(--surface-2)",
          color: active || done ? "var(--bg)" : "var(--ink-3)",
        }}
      >
        {done ? "✓" : active ? "•" : ""}
      </span>
      <span className={"text-xs " + (active ? "font-semibold text-ink" : "text-ink-3")}>{label}</span>
    </div>
  );
}
