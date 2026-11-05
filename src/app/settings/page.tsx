"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/SiteHeader";
import { AthleteProfileCard } from "@/components/AthleteProfileCard";
import {
  AthleteCorosCard,
  AthleteGarminCard,
  AthleteGarminDevCard,
  AthleteStravaCard,
  AthleteWhoopCard,
  AthleteZonesCard,
} from "@/components/settings/ConnectionCards";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { t, locale, toggle: toggleLocale } = useLocale();
  const isEn = locale === "en";
  const { me, signOut } = useAuth();
  const searchParams = useSearchParams();
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      // Read in an effect, not a lazy initializer — see the same note in
      // lib/i18n/context.tsx (avoids a server/client hydration mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("cadencia-theme") === "dark") setDark(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    try {
      if (next) {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("cadencia-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("cadencia-theme", "light");
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const strava = searchParams.get("strava");
    const coros = searchParams.get("coros");
    const garmindev = searchParams.get("garmindev");
    // Deriving a one-time toast from the ?strava=/?coros=/?garmindev=
    // redirect query params — not render-derived state, so this has to
    // live in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (strava === "connected") setToast(isEn ? "Strava connected." : "Strava conectado.");
    else if (strava === "error") setToast(isEn ? "Could not connect Strava. Try again." : "No se pudo conectar Strava. Intenta de nuevo.");
    else if (coros === "connected") setToast(isEn ? "COROS connected." : "COROS conectado.");
    else if (coros === "error") setToast(isEn ? "Could not connect COROS. Its API may not be configured yet." : "No se pudo conectar COROS. Puede que su API todavía no esté configurada.");
    else if (garmindev === "connected") setToast(isEn ? "Garmin connected." : "Garmin conectado.");
    else if (garmindev === "error")
      setToast(
        isEn
          ? "Could not connect Garmin. Its API may not be configured yet."
          : "No se pudo conectar Garmin. Puede que su API todavía no esté configurada."
      );
    const whoop = searchParams.get("whoop");
    if (whoop === "connected") setToast(isEn ? "WHOOP connected." : "WHOOP conectado.");
    else if (whoop === "error")
      setToast(
        isEn ? "Could not connect WHOOP. Its API may not be configured yet." : "No se pudo conectar WHOOP. Puede que su API todavía no esté configurada."
      );
  }, [searchParams, isEn]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("settings_h")}</h1>

          {toast && <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">{toast}</div>}

          {!me ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : (
            <>
              <AthleteProfileCard slug={me.slug} />

              <div className="mt-8">
                <AthleteZonesCard slug={me.slug} />
              </div>

              {/* Found live (Nov 2026, direct feedback: "la organización de
                  las cosas") — the 5 integration cards used to sit in three
                  separate 2-col grids stacked with mt-4 gaps, which left
                  WHOOP alone in its own row (an orphan slot) and read as a
                  loose pile of cards with no section heading. One labeled
                  section, one responsive grid now — ordered by how real/
                  usable each connection actually is today (Strava and
                  WHOOP fully working, Garmin Developer confirmed working,
                  then COROS — real MCP connection works now, but pushing a
                  workout doesn't yet, see CLAUDE.md — and the
                  lower-capability Garmin Personal key last, so if the grid
                  ever leaves an orphan cell on a wide screen it falls on
                  one of the two least-essential cards, not a primary one). */}
              <h2 className="mt-8 mb-3 text-sm uppercase tracking-widest text-ink-3">
                {isEn ? "Connections" : "Conexiones"}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AthleteStravaCard />
                <AthleteWhoopCard />
                <AthleteGarminDevCard />
                <AthleteCorosCard />
                <AthleteGarminCard />
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-5 border-t border-line pt-6">
                <button onClick={toggleLocale} className="text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors">
                  {t("other_lang")}
                </button>

                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors"
                >
                  {dark ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="3.5" />
                      <line x1="8" y1="1" x2="8" y2="2.5" />
                      <line x1="8" y1="13.5" x2="8" y2="15" />
                      <line x1="1" y1="8" x2="2.5" y2="8" />
                      <line x1="13.5" y1="8" x2="15" y2="8" />
                      <line x1="3.05" y1="3.05" x2="4.1" y2="4.1" />
                      <line x1="11.9" y1="11.9" x2="12.95" y2="12.95" />
                      <line x1="12.95" y1="3.05" x2="11.9" y2="4.1" />
                      <line x1="4.1" y1="11.9" x2="3.05" y2="12.95" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z" />
                    </svg>
                  )}
                  {dark ? (isEn ? "Light mode" : "Modo claro") : isEn ? "Dark mode" : "Modo oscuro"}
                </button>

                <button onClick={signOut} className="ml-auto text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors">
                  {t("sign_out")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
