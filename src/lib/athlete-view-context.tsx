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
  const [who, setWhoState] = useState<Who>("juan");
  const [lastSingle, setLastSingle] = useState<AthleteSlug>("juan");

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
