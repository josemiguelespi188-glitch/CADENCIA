"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// Dashboard was folded into the bottom of /calendar (see CLAUDE.md's
// "Merge Dashboard into Calendar" note) — no separate nav entry for it
// anymore. Community (Nov 2026) sits right after Calendar — see
// CLAUDE.md's "Community" section.
const NAV: { href: string; key: string }[] = [
  { href: "/calendar", key: "nav_calendar" },
  { href: "/community", key: "nav_community" },
  { href: "/templates", key: "nav_templates" },
  { href: "/settings", key: "nav_settings" },
];

export function SiteHeader() {
  const { t, locale } = useLocale();
  const { me, athletes, viewing, viewAthlete } = useAuth();
  const pathname = usePathname();
  const [friendsOpen, setFriendsOpen] = useState(false);
  const friendsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (friendsRef.current && !friendsRef.current.contains(e.target as Node)) setFriendsOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const friends = athletes.filter((a) => a.id !== me?.id);
  const isEn = locale === "en";

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <Link href="/calendar" className="flex items-center gap-2 leading-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed small logo, next/image's extra setup isn't needed here */}
          <img src="/logo.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="flex flex-col leading-none">
            <span
              className="text-lg font-black tracking-[0.05em] text-ink"
              style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
            >
              cadencia
            </span>
            <span className="text-[9px] uppercase tracking-[0.5em] text-ink-3 -mt-0.5">
              {t("brand_sub")}
            </span>
          </span>
        </Link>

        {me && (
          // Found live (Nov 2026, direct feedback: "la organización de las
          // cosas") — a subtle left border + padding separates the
          // Friends picker from the brand mark to its left, instead of
          // both groups just running together as one undifferentiated
          // row of flex items. The old plain-text "{me.name}" pill that
          // used to sit here moved to the right side as a clickable
          // profile chip (Nov 2026, direct feedback: "no me encanta...
          // debería salir como el perfil del usuario" — see below).
          //
          // Redesigned again (Nov 2026, direct feedback: "no me gusta que
          // se haga merge con sus actividades mi calendario... que sea
          // mas view my friends week") — this used to be a multi-select
          // checkbox list that merged several athletes' workouts/
          // activities onto one shared calendar. Now a single-select
          // switch: pick "My week" or exactly one friend, never both at
          // once — the old merged, multi-athlete view moved to Community
          // instead (aggregate stats, compare profiles), see CLAUDE.md.
          <div className="inline-flex items-center gap-2 border-l border-line pl-3">
            <div ref={friendsRef} className="relative">
              <button
                type="button"
                onClick={() => setFriendsOpen((v) => !v)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                  viewing[0] !== me.slug ? "bg-surface-2 text-ink" : "bg-surface-2 text-ink-2 hover:text-ink"
                )}
              >
                {viewing[0] !== me.slug ? (athletes.find((a) => a.slug === viewing[0])?.name ?? (isEn ? "Friends" : "Friends")) : isEn ? "Friends" : "Friends"} ▾
              </button>
              {friendsOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      viewAthlete(me.slug);
                      setFriendsOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                      viewing[0] === me.slug ? "font-semibold text-ink" : "text-ink-2"
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{viewing[0] === me.slug ? "●" : ""}</span>
                    {isEn ? "My week" : "Mi semana"}
                  </button>
                  {friends.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-ink-3">
                      {isEn ? "No one else here yet." : "Todavía no hay nadie más aquí."}
                    </p>
                  ) : (
                    <>
                      <div className="my-1 border-t border-line" />
                      {friends.map((f) => (
                        <button
                          type="button"
                          key={f.slug}
                          onClick={() => {
                            viewAthlete(f.slug);
                            setFriendsOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                            viewing[0] === f.slug ? "font-semibold text-ink" : "text-ink-2"
                          )}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{viewing[0] === f.slug ? "●" : ""}</span>
                          {isEn ? `${f.name}'s week` : `Semana de ${f.name}`}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <nav className="hidden items-center gap-2 sm:flex ml-auto">
          {/* Found live (Nov 2026, direct feedback: "la organización de las
              cosas") — Calendar/Generate/Settings used to be plain text
              links with only a color change for the active page, sitting
              next to Admin's own pill-badge styling — two different visual
              languages for "you are here" in the same nav. Wrapped in one
              segmented pill group now (bg-surface-2 track, bg-ink active
              segment) matching the pill aesthetic this app already uses
              everywhere else (buttons, the name/Friends badges). */}
          <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                  pathname === item.href ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"
                )}
              >
                {t(item.key)}
              </Link>
            ))}
          </div>

          {/* The profile chip (Nov 2026) — moved here from the left side,
              per direct feedback: "no me encanta... debería salir como
              el perfil del usuario, más no... mi nombre ahí arriba. A la
              derecha arriba pondría el perfil del usuario." A small
              initials avatar + name, clickable through to /settings
              (which already owns the full profile editor — no reason to
              build a second one), styled as a pill to match everything
              else in this nav rather than reusing the old plain
              bg-ink/text-bg "badge" look that made it read as just a
              label, not something to click. */}
          {me && (
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium uppercase tracking-wide transition-colors",
                pathname === "/settings" ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 hover:text-ink"
              )}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                style={{
                  background: pathname === "/settings" ? "var(--bg)" : "var(--ink)",
                  color: pathname === "/settings" ? "var(--ink)" : "var(--bg)",
                }}
              >
                {me.initials}
              </span>
              {me.name}
            </Link>
          )}

          {/* Admin, always the rightmost item when visible — per explicit
             instruction ("lo más a la derecha posible"). Kept visually
             distinct from the segmented group above (its own pill, not a
             segment inside it) since it's a different kind of link —
             conditional, admin-only — not a peer page in the main nav. */}
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
