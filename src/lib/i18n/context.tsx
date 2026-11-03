"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Locale = "es" | "en";

const DICT: Record<Locale, Record<string, string>> = {
  es: {
    brand_sub: "registro de entreno",
    both: "Ambos",
    nav_calendar: "Calendario",
    nav_dashboard: "Panel",
    nav_templates: "Generate",
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
    brick: "Bici + Trote",
    new_w: "Nuevo entreno",
    edit_w: "Editar entreno",
    athlete: "Atleta",
    date: "Fecha",
    sport: "Deporte",
    title: "Título",
    title_en: "Título (inglés, opcional)",
    start: "Hora de inicio",
    min: "Minutos",
    km: "Distancia (km)",
    notes: "Detalles",
    notes_en: "Detalles (inglés, opcional)",
    tpl_en_hint: "Se muestra cuando la plataforma está en inglés. Si se deja vacío, se usa el texto en español.",
    is_done: "Hecho",
    save: "Guardar",
    del: "Eliminar",
    cancel: "Cancelar",
    saved: "Guardado",
    deleted: "Eliminado",
    err_save: "No se pudo guardar. Intenta de nuevo.",
    loading: "Cargando…",
    empty_cal: "Todavía no hay entrenos para esta selección.",
    // "Generate" se queda igual en ambos idiomas a propósito — es el
    // nombre de la sección (Oct 2026: "el plantillas debería ser
    // Generate... siempre tiene que venir predeterminado en inglés"),
    // no una palabra a traducir.
    tpl_h: "Generate",
    tpl_sub: "Chatea con la IA, importa tu plan semanal o usa un entreno base.",
    presets_h: "Entrenos base",
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
    zone_recovery: "Recuperación",
    zone_endurance: "Resistencia",
    zone_tempo: "Tempo",
    zone_threshold: "Umbral",
    zone_vo2max: "VO2max",
    zone_anaerobic: "Anaeróbico",
    zone_neuromuscular: "Neuromuscular",
    hr_zones: "Zonas de frecuencia cardíaca",
    pace_zones: "Zonas de pace",
    power_zones: "Zonas de potencia",
    from_strava: "De Strava",
    computed: "Calculadas",
    need_threshold: "Agrega el umbral arriba para calcular las zonas.",
    workout_type: "Tipo de entreno",
    strava_comment: "Comentario para Strava",
    strava_comment_hint: "Resumen que se escribe tal cual en la actividad de Strava cuando se vincule. Si lo dejas vacío, la IA genera uno.",
    plan_import_h: "Plan semanal (Excel)",
    download_template: "Descargar plantilla",
    upload_excel: "Subir Excel",
    importing: "Importando…",
    import_done: "{n} entrenos importados.",
    import_errors: "{n} filas con error (no se importaron):",
    strava_totals_h: "Totales de Strava",
    totals_recent: "Últimas 4 sem.",
    totals_ytd: "Este año",
    totals_all: "Siempre",
    weight: "Peso",
    rpe: "Esfuerzo percibido (RPE)",
    rpe_hint: "0 = sin esfuerzo, 10 = esfuerzo máximo.",
    steps_h: "Pasos estructurados (opcional)",
    steps_add: "Agregar paso",
    steps_empty: "Todavía no hay pasos estructurados.",
    steps_hint: "Usado para sincronizar entrenos con intervalos a relojes como COROS, una vez conectado.",
    steps_repeat: "Repeticiones",
    steps_push_coros: "Mandar a COROS",
    steps_push_ok: "Enviado a COROS.",
    steps_push_garmin: "Mandar a Garmin",
    steps_push_garmin_ok: "Enviado a Garmin.",
    steps_ai_label: "Describe el entreno y la IA llena todo el formulario",
    steps_ai_placeholder: "Ej: 10min calentamiento, 6x400m a paso de 5K con 90s trote de recuperación, 10min enfriamiento",
    steps_ai_generate: "Generar con IA",
    steps_ai_generating: "Generando…",
    unit_min: "min",
    unit_m: "m",
    unit_pace: "s/km",
    unit_bpm: "lpm",
    unit_watts: "W",
    unit_rpm: "rpm",
    launcher_build_ai: "Crear con IA",
    launcher_workout_generator: "Generador de entrenos",
    launcher_add_workout: "Agregar un entreno",
    launcher_search_workouts: "Buscar entrenos",
    launcher_search_from_base: "Elegir de Base Workouts",
    search_workouts_placeholder: "Buscar por nombre…",
    search_workouts_all_sports: "Todos los deportes",
    search_workouts_empty: "No hay entrenos base que coincidan.",
    search_workouts_back: "Volver",
    steps_zone_pick: "Usar una zona…",
    step_warmup: "Calentamiento",
    step_work: "Trabajo",
    step_recovery: "Recuperación",
    step_cooldown: "Enfriamiento",
    step_rest: "Descanso",
    duration_time: "Tiempo",
    duration_distance: "Distancia",
    duration_open: "Libre",
    target_pace: "Pace",
    target_hr: "FC",
    target_power: "Potencia",
    target_cadence: "Cadencia",
    target_open: "Libre",
    target_low: "Mín",
    target_high: "Máx",
    planned_vs_completed: "Planificado vs. Completado",
    planned_label: "Planificado",
    completed_label: "Completado",
    gear: "Equipo",
    no_plan_matched: "Esta actividad no está vinculada a ningún entreno planificado.",
  },
  en: {
    brand_sub: "training log",
    both: "Both",
    nav_calendar: "Calendar",
    nav_dashboard: "Dashboard",
    // Found live (Nov 2026, full codebase audit): this never got the
    // "Generate" rename the Spanish entry (and tpl_h, both locales)
    // already have — "Generate" is treated as the section's actual
    // name, not a word to translate (see CLAUDE.md's "Templates
    // renamed to Generate" note), so every first-time visitor (default
    // locale is English) saw the stale "Templates" label in the nav.
    nav_templates: "Generate",
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
    brick: "Bike + Run",
    new_w: "New workout",
    edit_w: "Edit workout",
    athlete: "Athlete",
    date: "Date",
    sport: "Sport",
    title: "Title",
    title_en: "Title (English, optional)",
    start: "Start time",
    min: "Minutes",
    km: "Distance (km)",
    notes: "Details",
    notes_en: "Details (English, optional)",
    tpl_en_hint: "Shown when the platform is set to English. Falls back to the Spanish text if left blank.",
    is_done: "Done",
    save: "Save",
    del: "Delete",
    cancel: "Cancel",
    saved: "Saved",
    deleted: "Deleted",
    err_save: "Could not save. Please try again.",
    loading: "Loading…",
    empty_cal: "No workouts for this selection yet.",
    tpl_h: "Generate",
    tpl_sub: "Chat with AI, import your weekly plan, or use a base workout.",
    presets_h: "Base workouts",
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
    zone_recovery: "Recovery",
    zone_endurance: "Endurance",
    zone_tempo: "Tempo",
    zone_threshold: "Threshold",
    zone_vo2max: "VO2max",
    zone_anaerobic: "Anaerobic",
    zone_neuromuscular: "Neuromuscular",
    hr_zones: "Heart rate zones",
    pace_zones: "Pace zones",
    power_zones: "Power zones",
    from_strava: "From Strava",
    computed: "Computed",
    need_threshold: "Add the threshold above to compute zones.",
    workout_type: "Workout type",
    strava_comment: "Strava comment",
    strava_comment_hint: "Written verbatim onto the Strava activity once matched. Leave blank to let the AI draft one.",
    plan_import_h: "Weekly plan (Excel)",
    download_template: "Download template",
    upload_excel: "Upload Excel",
    importing: "Importing…",
    import_done: "{n} workouts imported.",
    import_errors: "{n} rows had errors (not imported):",
    strava_totals_h: "Strava totals",
    totals_recent: "Last 4 wks",
    totals_ytd: "This year",
    totals_all: "All time",
    weight: "Weight",
    rpe: "Rating of Perceived Exertion (RPE)",
    rpe_hint: "0 = no exertion, 10 = maximal effort.",
    steps_h: "Structured steps (optional)",
    steps_add: "Add step",
    steps_empty: "No structured steps yet.",
    steps_hint: "Used to sync interval workouts to watches like COROS, once connected.",
    steps_repeat: "Repeat count",
    steps_push_coros: "Push to COROS",
    steps_push_ok: "Sent to COROS.",
    steps_push_garmin: "Push to Garmin",
    steps_push_garmin_ok: "Sent to Garmin.",
    steps_ai_label: "Describe the workout and AI fills the whole form",
    steps_ai_placeholder: "E.g. 10min warmup, 6x400m at 5K pace with 90s jog recovery, 10min cooldown",
    steps_ai_generate: "Generate with AI",
    steps_ai_generating: "Generating…",
    unit_min: "min",
    unit_m: "m",
    unit_pace: "sec/km",
    unit_bpm: "bpm",
    unit_watts: "W",
    unit_rpm: "rpm",
    launcher_build_ai: "Build with AI",
    launcher_workout_generator: "Workout Generator",
    launcher_add_workout: "Add a Workout",
    launcher_search_workouts: "Search for Workouts",
    launcher_search_from_base: "Pick from Base Workouts",
    search_workouts_placeholder: "Search by name…",
    search_workouts_all_sports: "All sports",
    search_workouts_empty: "No base workouts match.",
    search_workouts_back: "Back",
    steps_zone_pick: "Use a zone…",
    step_warmup: "Warmup",
    step_work: "Work",
    step_recovery: "Recovery",
    step_cooldown: "Cooldown",
    step_rest: "Rest",
    duration_time: "Time",
    duration_distance: "Distance",
    duration_open: "Open",
    target_pace: "Pace",
    target_hr: "HR",
    target_power: "Power",
    target_cadence: "Cadence",
    target_open: "Open",
    target_low: "Low",
    target_high: "High",
    planned_vs_completed: "Planned vs. Completed",
    planned_label: "Planned",
    completed_label: "Completed",
    gear: "Gear",
    no_plan_matched: "This activity isn't linked to any planned workout.",
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
  // Defaults to English per explicit instruction (Oct 2026 — "siempre
  // tiene que venir predeterminado en inglés") — still toggleable, and
  // still remembers whatever the viewer last picked via localStorage.
  const [locale, setLocaleState] = useState<Locale>("en");

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
