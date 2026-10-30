"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Who, AthleteSlug } from "@/lib/types";

interface AthleteViewCtx {
  who: Who;
  setWho: (w: Who) => void;
  /** Last single athlete selected — used as the default when opening the
   * "add workout" dialog while viewing "both". */
  lastSingle: AthleteSlug;
}

const Ctx = createContext<AthleteViewCtx | null>(null);

export function AthleteViewProvider({ children }: { children: ReactNode }) {
  // Defaults to a single athlete, never "both" — showing two people's data
  // side by side by default read as confusing while this is really a
  // single-user test (José Miguel's real, connected account). A proper
  // "Friends" model (see José's explicit ask, Oct 2026) — picking whose
  // data to see as a social relationship, not a hardcoded two-person
  // roster — needs real auth back first (see CLAUDE.md's "Data model &
  // auth" section on why auth is currently off); not built here.
  const [who, setWhoState] = useState<Who>("jose");
  const [lastSingle, setLastSingle] = useState<AthleteSlug>("jose");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cadencia-who");
      // Read in an effect, not a lazy initializer — see the same note in
      // lib/i18n/context.tsx (avoids a server/client hydration mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "juan" || saved === "jose" || saved === "both") setWhoState(saved);
      const savedSingle = localStorage.getItem("cadencia-who-single");
      if (savedSingle === "juan" || savedSingle === "jose") setLastSingle(savedSingle);
    } catch {
      /* ignore */
    }
  }, []);

  function setWho(w: Who) {
    setWhoState(w);
    try {
      localStorage.setItem("cadencia-who", w);
      if (w !== "both") {
        setLastSingle(w);
        localStorage.setItem("cadencia-who-single", w);
      }
    } catch {
      /* ignore */
    }
  }

  return <Ctx.Provider value={{ who, setWho, lastSingle }}>{children}</Ctx.Provider>;
}

export function useAthleteView() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAthleteView must be used within AthleteViewProvider");
  return ctx;
}
