"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Locale = "es" | "en";

const DICT: Record<Locale, Record<string, string>> = {
  es: {
    brand_sub: "registro de entreno",
    both: "Ambos",
    nav_calendar: "Calendario",
    nav_dashboard: "Panel",
    nav_templates: "Plantillas",
    nav_settings: "Ajustes",
    sign_in: "Iniciar Sesión",
    sign_out: "Cerrar Sesión",
    week: "Semana",
    month: "Mes",
    today: "Hoy",
    prev: "Anterior",
    next: "Siguiente",
    add: "Agregar entreno",
    free: "Libre",
    sessions: "sesiones",
    planned: "planificado",
    done: "hecho",
    swim: "Natación",
    bike: "Bici",
    run: "Correr",
    gym: "Gimnasio",
    race: "Carrera",
    new_w: "Nuevo entreno",
    edit_w: "Editar entreno",
    athlete: "Atleta",
    date: "Fecha",
    sport: "Deporte",
    title: "Título",
    start: "Hora de inicio",
    min: "Minutos",
    km: "Distancia (km)",
    notes: "Detalles",
    is_done: "Hecho",
    save: "Guardar",
    del: "Eliminar",
    cancel: "Cancelar",
    saved: "Guardado",
    deleted: "Eliminado",
    err_save: "No se pudo guardar. Intenta de nuevo.",
    loading: "Cargando…",
    empty_cal: "Todavía no hay entrenos para esta selección.",
    tpl_h: "Plantillas",
    tpl_sub: "Entrenos base que puedes ajustar para cada atleta.",
    use: "Usar",
    edit: "Editar",
    new_t: "Nueva plantilla",
    edit_t: "Editar plantilla",
    empty_tpl: "Todavía no hay plantillas.",
    k_planned: "Planificado",
    k_done: "Hecho",
    k_sessions: "Sesiones",
    k_race: "Próxima carrera",
    days: "días",
    this_week: "esta semana",
    of: "de",
    no_race: "Sin carreras",
    vol: "Volumen semanal (horas)",
    by_sport: "Esta semana por deporte",
    upcoming: "Próximos 7 días",
    nothing: "Nada programado.",
    strava_connect: "Conectar Strava",
    strava_connected: "Strava conectado",
    strava_disconnect: "Desconectar",
    strava_sync: "Sincronizar ahora",
    strava_last_sync: "Última sincronización",
    strava_never: "Nunca",
    settings_h: "Ajustes",
    other_lang: "English",
    download_week: "Descargar semana",
    zones_h: "Zonas de entrenamiento",
    lthr: "Frecuencia cardíaca umbral (LTHR)",
    threshold_pace: "Pace umbral de trote",
    ftp: "FTP de bici",
    vo2max: "VO2max",
    zones_saved: "Zonas guardadas",
  },
  en: {
    brand_sub: "training log",
    both: "Both",
    nav_calendar: "Calendar",
    nav_dashboard: "Dashboard",
    nav_templates: "Templates",
    nav_settings: "Settings",
    sign_in: "Sign In",
    sign_out: "Sign Out",
    week: "Week",
    month: "Month",
    today: "Today",
    prev: "Previous",
    next: "Next",
    add: "Add workout",
    free: "Free",
    sessions: "sessions",
    planned: "planned",
    done: "done",
    swim: "Swim",
    bike: "Bike",
    run: "Run",
    gym: "Gym",
    race: "Race",
    new_w: "New workout",
    edit_w: "Edit workout",
    athlete: "Athlete",
    date: "Date",
    sport: "Sport",
    title: "Title",
    start: "Start time",
    min: "Minutes",
    km: "Distance (km)",
    notes: "Details",
    is_done: "Done",
    save: "Save",
    del: "Delete",
    cancel: "Cancel",
    saved: "Saved",
    deleted: "Deleted",
    err_save: "Could not save. Please try again.",
    loading: "Loading…",
    empty_cal: "No workouts for this selection yet.",
    tpl_h: "Templates",
    tpl_sub: "Base workouts you can adjust for each athlete.",
    use: "Use",
    edit: "Edit",
    new_t: "New template",
    edit_t: "Edit template",
    empty_tpl: "No templates yet.",
    k_planned: "Planned",
    k_done: "Done",
    k_sessions: "Sessions",
    k_race: "Next race",
    days: "days",
    this_week: "this week",
    of: "of",
    no_race: "No races",
    vol: "Weekly volume (hours)",
    by_sport: "This week by sport",
    upcoming: "Next 7 days",
    nothing: "Nothing scheduled.",
    strava_connect: "Connect Strava",
    strava_connected: "Strava connected",
    strava_disconnect: "Disconnect",
    strava_sync: "Sync now",
    strava_last_sync: "Last synced",
    strava_never: "Never",
    settings_h: "Settings",
    other_lang: "Español",
    download_week: "Download week",
    zones_h: "Training zones",
    lthr: "Lactate threshold heart rate (LTHR)",
    threshold_pace: "Running threshold pace",
    ftp: "Bike FTP",
    vo2max: "VO2max",
    zones_saved: "Zones saved",
  },
};

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("es");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cadencia-locale");
      // Deliberately read in an effect, not a lazy useState initializer: the
      // server has no localStorage, so reading it synchronously during
      // render would make the client's first render disagree with the
      // server-rendered HTML (a hydration mismatch) instead of this.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "es" || saved === "en") setLocaleState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try {
      localStorage.setItem("cadencia-locale", l);
    } catch {
      /* ignore */
    }
  }

  function toggle() {
    setLocale(locale === "es" ? "en" : "es");
  }

  function t(key: string, replacements?: Record<string, string | number>) {
    let s = DICT[locale][key] ?? key;
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        s = s.replace(`{${k}}`, String(v));
      }
    }
    return s;
  }

  return <Ctx.Provider value={{ locale, setLocale, toggle, t }}>{children}</Ctx.Provider>;
}

export function useLocale() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
