"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
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
  const { me, athletes, viewing, toggleFriend, signOut } = useAuth();
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const friendsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (friendsRef.current && !friendsRef.current.contains(e.target as Node)) setFriendsOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
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

  const friends = athletes.filter((a) => a.id !== me?.id);
  const isEn = locale === "en";

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

        {me && (
          <div className="inline-flex items-center gap-2">
            <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-bg">
              {me.name}
            </span>
            <div ref={friendsRef} className="relative">
              <button
                type="button"
                onClick={() => setFriendsOpen((v) => !v)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                  viewing.length > 1 ? "bg-surface-2 text-ink" : "bg-surface-2 text-ink-2 hover:text-ink"
                )}
              >
                {isEn ? "Friends" : "Friends"} {viewing.length > 1 ? `(${viewing.length - 1})` : ""} ▾
              </button>
              {friendsOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
                  {friends.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-ink-3">
                      {isEn ? "No one else here yet." : "Todavía no hay nadie más aquí."}
                    </p>
                  ) : (
                    friends.map((f) => (
                      <label
                        key={f.slug}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
                      >
                        <input
                          type="checkbox"
                          checked={viewing.includes(f.slug)}
                          onChange={() => toggleFriend(f.slug)}
                          className="h-4 w-4"
                        />
                        {f.name}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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

          <button onClick={signOut} className="text-sm text-ink-2 hover:text-ink transition-colors">
            {t("sign_out")}
          </button>

          {/* Admin, always the rightmost item when visible — per explicit
             instruction ("lo más a la derecha posible"). */}
          {me?.is_admin && (
            <Link
              href="/admin"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                pathname?.startsWith("/admin") ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 hover:text-ink"
              )}
            >
              {isEn ? "Admin" : "Admin"}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
