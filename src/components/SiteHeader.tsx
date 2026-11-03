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
  const { t, locale } = useLocale();
  const { me, athletes, viewing, toggleFriend } = useAuth();
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
          // identity cluster (name/Friends) from the brand mark to its
          // left, instead of both groups just running together as one
          // undifferentiated row of flex items.
          <div className="inline-flex items-center gap-2 border-l border-line pl-3">
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
