"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAthleteView } from "@/lib/athlete-view-context";
import { ATHLETES, type Who } from "@/lib/types";
import { cn } from "@/lib/utils";

// Dashboard was folded into the bottom of /calendar (see CLAUDE.md's
// "Merge Dashboard into Calendar" note) — no separate nav entry for it
// anymore.
const NAV: { href: string; key: string }[] = [
  { href: "/calendar", key: "nav_calendar" },
  { href: "/templates", key: "nav_templates" },
  { href: "/settings", key: "nav_settings" },
];

export function SiteHeader() {
  const { t, locale, toggle: toggleLocale } = useLocale();
  const { who, setWho } = useAthleteView();
  const pathname = usePathname();
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

  const whoOptions: Who[] = ["juan", "jose", "both"];

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <Link href="/calendar" className="flex flex-col leading-none">
          <span
            className="text-lg font-black tracking-[0.05em] text-ink"
            style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
          >
            cadencia
          </span>
          <span className="text-[9px] uppercase tracking-[0.5em] text-ink-3 -mt-0.5">
            {t("brand_sub")}
          </span>
        </Link>

        <div className="inline-flex rounded-full bg-surface-2 p-1 gap-0.5">
          {whoOptions.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWho(w)}
              aria-pressed={who === w}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                who === w ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"
              )}
            >
              {w === "both" ? t("both") : ATHLETES[w].name}
            </button>
          ))}
        </div>

        <nav className="hidden items-center gap-5 sm:flex ml-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm transition-colors",
                pathname === item.href ? "text-ink font-medium" : "text-ink-2 hover:text-ink"
              )}
            >
              {t(item.key)}
            </Link>
          ))}

          <button onClick={toggleLocale} className="text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors">
            {locale === "es" ? "EN" : "ES"}
          </button>

          <button
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light" : "Switch to dark"}
            className="text-ink-3 hover:text-ink transition-colors leading-none"
          >
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z" />
              </svg>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
