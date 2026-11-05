"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Public marketing/landing page (Nov 2026, direct follow-up: "quiero
 * antes de entrar ahí que haya una landing page explicativa... siguiendo
 * nuestro manual de marca"). The reference screenshots shared (FinalSurge,
 * Intervals.icu, TrainingPeaks) were explicitly for CONTENT/STRUCTURE —
 * hero + subheadline + CTAs, a "connects with" integrations strip,
 * athlete-facing vs. coach-facing feature sections, a closing CTA band —
 * not for visual style: this page uses Cadencia's own existing design
 * system unchanged (monochrome ink/surface/line tokens, IBM Plex Sans +
 * JetBrains Mono wordmark, pill buttons, rounded-2xl cards,
 * uppercase-tracked micro-labels — see CLAUDE.md's "Design system"
 * section), not FinalSurge's red or Intervals.icu's indigo.
 *
 * Deliberately does NOT borrow Intervals.icu's usage-stats row
 * ("200,000+ Active Athletes," etc.) — this app has no real users to
 * report yet, and fabricating a number here would be exactly the kind of
 * dishonesty this codebase avoids everywhere else (Best Efforts never
 * called "PR," Fitness/Fatigue/Form always labeled "estimated," etc). The
 * "Connects with" integrations strip only lists Strava/WHOOP/Garmin/
 * COROS — all four really do have a working connect flow in this app
 * (see their own CLAUDE.md sections), even though COROS's push isn't
 * built yet; no logo IMAGES are used (would need real brand assets this
 * app doesn't have), just styled monochrome text wordmarks, which also
 * reads more like this app's own restrained brand than borrowed color
 * logos would.
 *
 * The actual registration form lives at `/register` (moved there from
 * this route) — this page is pure marketing with two kinds of CTA,
 * "Get Started" (-> /register) and "Log In" (-> /calendar, which shows
 * the existing gated sign-in screen, unchanged).
 */
export default function LandingPage() {
  const { locale } = useLocale();
  const isEn = locale === "en";

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-7 w-7 rounded-lg" />
            <span
              className="text-lg font-black tracking-[0.05em] text-ink"
              style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
            >
              cadencia
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/calendar">
              <Button variant="ghost" size="sm">
                {isEn ? "Log In" : "Iniciar sesión"}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">{isEn ? "Sign Up" : "Regístrate"}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ─── Hero ─── */}
        <section className="px-6 pt-20 pb-16 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-3">
            {isEn ? "training log" : "registro de entreno"}
          </p>
          <h1 className="mx-auto mt-4 max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            {isEn ? "Train with purpose. Together." : "Entrena con propósito. Juntos."}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-2">
            {isEn
              ? "Plan your workouts on a real training calendar, sync real data from Strava, WHOOP and Garmin, and train in sync with your community — all in one place."
              : "Planifica tus entrenamientos en un calendario real, sincroniza datos reales de Strava, WHOOP y Garmin, y entrena en sincronía con tu comunidad — todo en un solo lugar."}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register">
              <Button size="lg">{isEn ? "Get Started" : "Empezar"}</Button>
            </Link>
            <Link href="/calendar">
              <Button variant="outline" size="lg">
                {isEn ? "Log In" : "Iniciar sesión"}
              </Button>
            </Link>
          </div>

          <div className="mx-auto mt-16 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-3">
              {isEn ? "Connects with" : "Se conecta con"}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              {["STRAVA", "WHOOP", "GARMIN", "COROS"].map((brand) => (
                <span key={brand} className="text-lg font-bold tracking-wide text-ink-3">
                  {brand}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ─── For athletes ─── */}
        <FeatureSection
          eyebrow={isEn ? "For athletes" : "Para atletas"}
          title={isEn ? "A training log that actually knows what you did" : "Un registro que de verdad sabe lo que hiciste"}
          bullets={
            isEn
              ? [
                  "A real training calendar — swim, bike, run, gym, brick, race.",
                  "Auto-synced real data from Strava, WHOOP and Garmin.",
                  "Real HR/pace/power training zones and a race-time predictor.",
                  "AI helps you build a structured workout from a plain description.",
                  "Download your week to any calendar app.",
                ]
              : [
                  "Un calendario de entrenamiento real — natación, bici, trote, gimnasio, brick, carrera.",
                  "Datos reales sincronizados de Strava, WHOOP y Garmin.",
                  "Zonas de FC/pace/potencia reales y un predictor de tiempos de carrera.",
                  "La IA te arma un entreno estructurado a partir de una descripción simple.",
                  "Descarga tu semana a cualquier app de calendario.",
                ]
          }
          mock={<CalendarMock />}
        />

        {/* ─── For coaches ─── */}
        <FeatureSection
          eyebrow={isEn ? "For coaches" : "Para coaches"}
          title={isEn ? "See your whole team, not just one athlete" : "Ve a todo tu equipo, no solo a un atleta"}
          bullets={
            isEn
              ? [
                  "Create a Community for your club or team.",
                  "See everyone's combined stats and a leaderboard.",
                  "Compare two athletes side by side, visually.",
                  "Assign one workout to the whole community at once.",
                ]
              : [
                  "Crea una Comunidad para tu club o equipo.",
                  "Mira las estadísticas combinadas de todos y una tabla de posiciones.",
                  "Compara a dos atletas lado a lado, de forma visual.",
                  "Asigna un mismo entreno a toda la comunidad de una vez.",
                ]
          }
          mock={<LeaderboardMock />}
          reverse
        />

        {/* ─── Closing CTA ─── */}
        <section className="bg-ink px-6 py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-bg sm:text-3xl">
            {isEn ? "Ready to train with purpose?" : "¿Listo para entrenar con propósito?"}
          </h2>
          <div className="mt-6">
            <Link href="/register">
              <Button size="lg" className="bg-bg text-ink hover:opacity-90">
                {isEn ? "Get Started" : "Empezar"}
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
          <span
            className="text-sm font-bold tracking-[0.05em] text-ink-3"
            style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
          >
            cadencia
          </span>
          <Link href="/privacy" className="text-xs text-ink-3 hover:text-ink">
            {isEn ? "Privacy" : "Privacidad"}
          </Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureSection({
  eyebrow,
  title,
  bullets,
  mock,
  reverse,
}: {
  eyebrow: string;
  title: string;
  bullets: string[];
  mock: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section className="border-t border-line px-6 py-16">
      <div className={cn("mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2", reverse && "lg:[&>*:first-child]:order-2")}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-3">{eyebrow}</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h2>
          <ul className="mt-6 flex flex-col gap-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-ink-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center">{mock}</div>
      </div>
    </section>
  );
}

/** Decorative mock built from this app's own real calendar-chip look —
 * not a fabricated screenshot, just the same `.s-<sport>` color pattern
 * the real Calendar page already uses. */
function CalendarMock() {
  const rows: { sport: "run" | "bike" | "swim"; label: string; sub: string }[] = [
    { sport: "run", label: "Tempo Run", sub: "50 min · 8.5 km" },
    { sport: "bike", label: "Endurance Ride", sub: "1h 30min · 35 km" },
    { sport: "swim", label: "Technique Swim", sub: "45 min · 2000 m" },
  ];
  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-3">This week</p>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className={cn("s-" + r.sport, "flex items-center gap-3 rounded-xl border border-line p-3")} style={{ background: "var(--soft)" }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--c)" }} />
            <div>
              <p className="text-sm font-medium text-ink">{r.label}</p>
              <p className="text-xs text-ink-3">{r.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Decorative mock for the Compare/Community feature — same fixed
 * bike/gym color pair `CompareProfiles.tsx` already uses for "athlete A
 * vs athlete B" visuals throughout that feature. */
function LeaderboardMock() {
  const rows = [
    { name: "José Miguel", km: 42, pct: 100 },
    { name: "Juan", km: 31, pct: 74 },
  ];
  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Leaderboard</p>
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={r.name} className="grid grid-cols-[16px_90px_1fr_auto] items-center gap-2 text-sm">
            <span className="text-xs font-bold text-ink-3">{i + 1}</span>
            <span className="truncate font-medium text-ink">{r.name}</span>
            <div className="h-2.5 rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: i === 0 ? "var(--bike)" : "var(--gym)" }} />
            </div>
            <span className="text-xs tabular-nums text-ink-3">{r.km} km</span>
          </div>
        ))}
      </div>
    </div>
  );
}
