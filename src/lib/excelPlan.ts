import ExcelJS from "exceljs";
import {
  SPORTS,
  type AthleteSlug,
  type PersonalBest,
  type Sport,
  type WorkoutStep,
  type WorkoutStepDurationType,
  type WorkoutStepKind,
  type WorkoutStepTargetType,
} from "@/lib/types";
import { durationLabel } from "@/lib/dates";
import { predictRaceTimes } from "@/lib/racePredictor";
import { computeHrZones, computePaceZones, computePowerZones, type ZoneKey } from "@/lib/zones";

/**
 * The weekly-plan Excel template — download it, fill it out (any number
 * of rows, any week), upload it back on /calendar to bulk-create every
 * workout at once. Per explicit instruction, it carries EVERYTHING a
 * workout needs: who, when (start/end time so the calendar event's exact
 * window is unambiguous), what, and both the internal notes AND the
 * separate Strava Description. See CLAUDE.md's "Excel weekly-plan
 * import" section for the full rationale.
 *
 * **Structured Steps (Nov 2026)**: direct instruction — "de alguna
 * manera tenemos que añadir al excel el structured steps. porque la
 * idea es que eso siempre vaya. para que se cargue al reloj el
 * entrenamiento" — every workout imported through this file is now
 * expected to carry its own warmup/work/recovery/cooldown structure,
 * since that's what actually gets pushed to a connected watch (see
 * lib/integrations/garminDeveloper.ts's `pushStructuredWorkoutToGarmin`
 * and lib/integrations/corosMcp.ts's `pushStructuredWorkoutToCorosMcp`
 * — both throw outright for a workout with no structured steps).
 * **Lives in the Plan sheet itself, as its own column** — direct
 * follow-up correction: "el structure step tiene que ir en plan" (the
 * first version put it on a separate sheet, matched by Athlete+Date+
 * Title; moved into Plan per this explicit instruction). Since a
 * workout can have any number of steps, one cell can't hold a normal
 * table — it holds a compact, semicolon-separated mini-syntax instead:
 * `<Kind> <Duration> [x<Repeat>] [@<Target> <Low>[-<High>]]`, steps
 * separated by `;`. See `parseStructuredStepsCell()`'s own comment for
 * the exact grammar and `addGuideSheet()`'s "Structured Steps" section
 * for the athlete-facing explanation with worked examples.
 */

const SPORT_LABEL: Record<Sport, { es: string; en: string }> = {
  swim: { es: "Natación", en: "Swim" },
  bike: { es: "Bici", en: "Bike" },
  run: { es: "Correr", en: "Run" },
  gym: { es: "Gimnasio", en: "Gym" },
  race: { es: "Carrera", en: "Race" },
  brick: { es: "Bici + Trote", en: "Bike + Run" },
};

type Locale = "es" | "en";

// Nov 2026 — same label strings WorkoutDialog.tsx's `t("step_...")`/
// `t("duration_...")`/`t("target_...")` keys already use, mirrored here
// since this file builds/parses the standalone Excel file server-side
// and has no access to the i18n context. See this file's own header for
// why structured steps now live in the Excel template at all.
const STEP_KIND_LABEL: Record<WorkoutStepKind, { es: string; en: string }> = {
  warmup: { es: "Calentamiento", en: "Warmup" },
  work: { es: "Trabajo", en: "Work" },
  recovery: { es: "Recuperación", en: "Recovery" },
  cooldown: { es: "Enfriamiento", en: "Cooldown" },
  rest: { es: "Descanso", en: "Rest" },
};
const DURATION_TYPE_LABEL: Record<WorkoutStepDurationType, { es: string; en: string }> = {
  time: { es: "Tiempo", en: "Time" },
  distance: { es: "Distancia", en: "Distance" },
  open: { es: "Libre", en: "Open" },
};
const TARGET_TYPE_LABEL: Record<WorkoutStepTargetType, { es: string; en: string }> = {
  pace: { es: "Pace", en: "Pace" },
  hr: { es: "FC", en: "HR" },
  power: { es: "Potencia", en: "Power" },
  cadence: { es: "Cadencia", en: "Cadence" },
  open: { es: "Libre", en: "Open" },
};
const STEP_KINDS: WorkoutStepKind[] = ["warmup", "work", "recovery", "cooldown", "rest"];
const DURATION_TYPES: WorkoutStepDurationType[] = ["time", "distance", "open"];
const TARGET_TYPES: WorkoutStepTargetType[] = ["pace", "hr", "power", "cadence", "open"];

const ZONE_LABEL: Record<ZoneKey, { es: string; en: string }> = {
  recovery: { es: "Recuperación", en: "Recovery" },
  endurance: { es: "Resistencia", en: "Endurance" },
  tempo: { es: "Tempo", en: "Tempo" },
  threshold: { es: "Umbral", en: "Threshold" },
  vo2max: { es: "VO2max", en: "VO2max" },
  anaerobic: { es: "Anaeróbico", en: "Anaerobic" },
  neuromuscular: { es: "Neuromuscular", en: "Neuromuscular" },
};

/**
 * Everything from an athlete's /settings profile, shaped for export —
 * passed in by the template route (which reads it from Supabase
 * server-side) rather than queried here, keeping this file DB-free like
 * the rest of it. See CLAUDE.md's "Athlete profile in the Weekly Plan
 * Excel" note: per explicit instruction, the single downloadable Excel
 * carries BOTH athletes' full profile (not just the week's workouts), so
 * handing the whole file to an AI agent gives it everything it needs to
 * reason about either triathlete.
 */
export interface AthleteProfileExport {
  slug: AthleteSlug;
  name: string;
  birthDate: string | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  restingHr: number | null;
  maxHr: number | null;
  thresholdHr: number | null;
  thresholdPaceSecPerKm: number | null;
  ftpWatts: number | null;
  vo2max: number | null;
  goalRaceName: string | null;
  goalRaceDate: string | null;
  goalDistance: string | null;
  goalNotes: string | null;
  personalBests: PersonalBest[];
}

// "Strava Description" (Nov 2026) — literally this, in BOTH locales, not
// translated — matches the app-wide rename documented in CLAUDE.md's
// "Auto-complete retried every sync, direct per-activity description
// edit" section ("Cambia la palabra comentarios por Strava Description"):
// this is the field's real/actual name now, the same "Generate" already
// got, not a phrase to translate.
const COLS = (locale: Locale) =>
  locale === "en"
    ? [
        "Athlete",
        "Date (YYYY-MM-DD)",
        "Sport",
        "Start time (HH:MM)",
        "End time (HH:MM)",
        "Minutes (if no times)",
        "Title",
        "Workout type",
        "Distance (km)",
        "Notes / objective",
        "Strava Description",
        "Done (Yes/No)",
        "Structured Steps (optional, see Guide)",
      ]
    : [
        "Atleta",
        "Fecha (AAAA-MM-DD)",
        "Deporte",
        "Hora inicio (HH:MM)",
        "Hora fin (HH:MM)",
        "Minutos (si no hay horas)",
        "Título",
        "Tipo de entreno",
        "Distancia (km)",
        "Notas / objetivo",
        "Strava Description",
        "Hecho (Sí/No)",
        "Pasos Estructurados (opcional, ver Guía)",
      ];

export async function buildPlanTemplate(locale: Locale = "es", athletes: AthleteProfileExport[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(locale === "en" ? "Plan" : "Plan");
  const cols = COLS(locale);

  ws.columns = cols.map((header) => ({ header, width: Math.max(16, header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E6" } };

  const athleteNames = athletes.map((a) => a.name);
  const sportNames = SPORTS.map((s) => SPORT_LABEL[s][locale]);
  const doneOptions = locale === "en" ? ["Yes", "No"] : ["Sí", "No"];

  // One example row, left in on purpose as a visible reference — added
  // BEFORE the data-validation loop below, so it lands on row 2 (setting
  // dataValidation on a cell materializes that row, which would otherwise
  // push addRow()'s result past all of them). This is a real interval
  // session (not a plain easy run), with a filled-in Structured Steps
  // cell demonstrating the mini-syntax end to end, plus a worked example
  // of what a good Strava Description actually reads like (short, past
  // tense, matches the "AI-generated content" style this app's own
  // generator already writes — see CLAUDE.md).
  const EXAMPLE_STEPS =
    locale === "en"
      ? "Warmup 15min; Work 5min x5; Recovery 3min x5; Cooldown 10min"
      : "Calentamiento 15min; Trabajo 5min x5; Recuperación 3min x5; Enfriamiento 10min";
  ws.addRow([
    athleteNames[0] ?? "",
    "2026-11-03",
    sportNames[2],
    "06:00",
    "06:33",
    "",
    locale === "en" ? "Interval session" : "Serie de intervalos",
    locale === "en" ? "Intervals" : "Series",
    5,
    locale === "en" ? "5x5min at threshold effort, 3min easy jog recovery between reps." : "5x5min a esfuerzo de umbral, 3min de trote suave de recuperación entre repeticiones.",
    locale === "en"
      ? "Interval session: 15min warmup, 5x5min at threshold with 3min recovery, 10min cooldown."
      : "Serie de intervalos: 15min de calentamiento, 5x5min a umbral con 3min de recuperación, 10min de enfriamiento.",
    doneOptions[1],
    EXAMPLE_STEPS,
  ]);
  ws.getRow(2).font = { italic: true, color: { argb: "FF8A8B8E" } };

  const LAST_ROW = 200;
  for (let r = 2; r <= LAST_ROW; r++) {
    ws.getCell(`A${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${athleteNames.join(",")}"`] };
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${sportNames.join(",")}"`] };
    ws.getCell(`L${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${doneOptions.join(",")}"`] };
  }

  // Nov 2026, direct instruction: "quiero que en gris en la primera
  // hoja pongas todas las opciones que pueden haber de sport" — a
  // plain gray reference list next to the table (column C's own
  // dropdown already enforces this, but a visible written list next to
  // it is what was actually asked for). Column O leaves column N as a
  // gap after M (Structured Steps, the table's last column).
  ws.getCell("O1").value = locale === "en" ? "Sport options" : "Opciones de deporte";
  ws.getCell("O1").font = { bold: true, color: { argb: "FF8A8B8E" } };
  sportNames.forEach((name, i) => {
    const cell = ws.getCell(`O${i + 2}`);
    cell.value = name;
    cell.font = { color: { argb: "FF8A8B8E" } };
  });
  ws.getColumn("O").width = Math.max(16, ...sportNames.map((s) => s.length + 2));

  addGuideSheet(wb, locale);

  if (athletes.length) {
    addAthleteProfileSheets(wb, locale, athletes);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * The former "Notes" sheet, rewritten into an actual guide (Nov 2026,
 * direct instruction: "quiero que en la segunda hoja en vez de notes
 * sea mas prompt. como poner bien un strava description... todas las
 * opciones que hay por cada field, si hay") — a real writing guide for
 * the Strava Description field (what it's for, what a good one looks
 * like, worked examples) plus a complete reference of every fixed
 * option set this whole workbook uses, not just the quick reminders the
 * old version had.
 */
function addGuideSheet(wb: ExcelJS.Workbook, locale: Locale) {
  const isEn = locale === "en";
  const ws = wb.addWorksheet(isEn ? "Guide" : "Guía");
  ws.columns = [{ width: 100 }];

  function heading(text: string) {
    const row = ws.addRow([text]);
    row.font = { bold: true };
  }
  function line(text: string) {
    ws.addRow([text]);
  }
  function blank() {
    ws.addRow([""]);
  }

  heading(isEn ? "Basics" : "Lo básico");
  (isEn
    ? [
        "One row per workout on the Plan sheet. Delete the example row (row 2) before uploading, or leave it: it will just create one more workout.",
        "Athlete / Sport / Done have dropdowns, pick from the list so the import can match them.",
        "Give either Start time + End time, OR just Minutes, not both. Times win if both are present.",
        "Date must be YYYY-MM-DD.",
        "Notes is the internal objective (for you, not posted anywhere); Strava Description is the one written to the actual Strava activity.",
      ]
    : [
        "Una fila por entreno en la hoja Plan. Borra la fila de ejemplo (fila 2) antes de subir, o déjala: solo va a crear un entreno más.",
        "Atleta / Deporte / Hecho tienen listas desplegables, elige de ahí para que la importación los reconozca.",
        "Pon Hora inicio + Hora fin, O solo Minutos, no hace falta ambos. Si pones las dos horas, esas mandan sobre Minutos.",
        "La fecha debe ir como AAAA-MM-DD.",
        "Notas es el objetivo interno (para ti, no se publica en ningún lado); Strava Description es la que se escribe en la actividad real de Strava.",
      ]
  ).forEach(line);
  blank();

  heading(isEn ? "How to write a good Strava Description" : "Cómo escribir un buen Strava Description");
  (isEn
    ? [
        "This is the short recap that gets posted verbatim onto the matched Strava activity once it syncs — think of it as the caption someone reads scrolling their Strava feed, not training notes.",
        "Keep it to 1-2 sentences. Past tense, as if the session already happened (it's written at upload time, before the workout, but reads naturally once it's done).",
        "Name the structure, not the feeling: warmup/main set/cooldown, reps x duration, the effort level. Skip subjective commentary (\"felt great\", \"tough one\") — that's not what this field is for.",
        'Good example: "Interval session: 15min warmup, 5x5min at threshold with 3min recovery, 10min cooldown."',
        'Good example: "Easy 10K to open the week, zone 2 the whole way."',
        'Too vague: "Good run today."',
        "Leave it blank to let the app's own AI draft one automatically once this workout syncs to Strava — only fill it in if you want the exact wording.",
      ]
    : [
        "Es el resumen corto que se publica tal cual en la actividad de Strava una vez que se vincule — piénsalo como el pie de foto que alguien lee en su feed de Strava, no como notas de entrenamiento.",
        "Máximo 1-2 oraciones. En pasado, como si la sesión ya hubiera pasado (se escribe al subir el Excel, antes del entreno, pero se lee natural una vez hecho).",
        "Describe la estructura, no cómo te sentiste: calentamiento/bloque principal/enfriamiento, repeticiones x duración, el nivel de esfuerzo. Evita comentarios subjetivos (\"me sentí increíble\", \"durísimo\") — no es para eso este campo.",
        'Buen ejemplo: "Serie de intervalos: 15min de calentamiento, 5x5min a umbral con 3min de recuperación, 10min de enfriamiento."',
        'Buen ejemplo: "Rodaje suave de 10K para abrir la semana, zona 2 todo el camino."',
        'Muy vago: "Buen entreno hoy."',
        "Déjalo vacío para que la IA de la app redacte uno automáticamente cuando este entreno se sincronice con Strava — llénalo solo si quieres el texto exacto.",
      ]
  ).forEach(line);
  blank();

  heading(isEn ? "Structured Steps (for syncing to a watch)" : "Pasos Estructurados (para sincronizar al reloj)");
  (isEn
    ? [
        'It\'s one column on the Plan sheet, "Structured Steps" — several steps in ONE cell, separated by semicolons ( ; ).',
        "Each step: <Step type> <Duration> [x<Repeat>] [@<Target type> <Low>[-<High>]]",
        'Duration is a number + "min" for Time (e.g. "15min"), a number + "m" for Distance (e.g. "400m"), or the word "Open" for no fixed duration.',
        'Example with no targets: "Warmup 15min; Work 5min x5; Recovery 3min x5; Cooldown 10min" — this is the Plan sheet\'s own example row.',
        'Example with targets: "Work 5min x5 @Pace 240-260; Recovery 3min x5 @HR 120-140" — pace is seconds per km (240 = 4:00/km), HR is bpm. A single value with no dash (e.g. "@Power 220") sets both ends to that number.',
        "This should always be filled in when the workout is meant to go onto a watch (Garmin and COROS both work now, running and cycling only for COROS) — a workout with no structured steps can't be pushed, only one with real steps can.",
        "A brick (bike + run) is still just ONE Plan row — don't split it into two; mix bike and run steps in order in the same Structured Steps cell if you want that level of detail.",
        "Leave the cell blank for a workout you don't need on a watch — Structured Steps is optional, everything else in this guide still applies without it.",
      ]
    : [
        'Es una sola columna en la hoja Plan, "Pasos Estructurados" — varios pasos en UNA celda, separados por punto y coma ( ; ).',
        "Cada paso: <Tipo de paso> <Duración> [x<Repeticiones>] [@<Tipo de objetivo> <Mínimo>[-<Máximo>]]",
        'La duración es un número + "min" para Tiempo (ej. "15min"), un número + "m" para Distancia (ej. "400m"), o la palabra "Libre"/"Open" para sin duración fija.',
        'Ejemplo sin objetivos: "Calentamiento 15min; Trabajo 5min x5; Recuperación 3min x5; Enfriamiento 10min" — es la fila de ejemplo de la hoja Plan.',
        'Ejemplo con objetivos: "Trabajo 5min x5 @Pace 240-260; Recuperación 3min x5 @FC 120-140" — pace es segundos por km (240 = 4:00/km), FC es lpm. Un solo valor sin guión (ej. "@Potencia 220") pone ambos extremos en ese número. También acepta las palabras en inglés (Warmup, Work, HR, etc.) si las prefieres.',
        "Esto debería llenarse siempre que el entreno vaya a ir al reloj (Garmin y COROS ya funcionan, COROS solo para correr y bici) — un entreno sin pasos estructurados no se puede mandar, solo uno con pasos reales.",
        "Un brick (bici + trote) sigue siendo UNA sola fila de Plan — no lo dividas en dos; mezcla pasos de bici y de trote en orden en la misma celda de Pasos Estructurados si quieres ese nivel de detalle.",
        "Deja la celda vacía para un entreno que no necesitas en el reloj — Pasos Estructurados es opcional, el resto de esta guía sigue aplicando sin él.",
      ]
  ).forEach(line);
  blank();

  heading(isEn ? "All field options" : "Todas las opciones por campo");
  line((isEn ? "Sport: " : "Deporte: ") + SPORTS.map((s) => SPORT_LABEL[s][locale]).join(", "));
  line((isEn ? "Done: " : "Hecho: ") + (isEn ? "Yes, No" : "Sí, No"));
  line((isEn ? "Step type: " : "Tipo de paso: ") + STEP_KINDS.map((k) => STEP_KIND_LABEL[k][locale]).join(", "));
  line(
    (isEn ? "Duration type: " : "Tipo de duración: ") +
      DURATION_TYPES.map((d) => `${DURATION_TYPE_LABEL[d][locale]}${d === "time" ? " (min)" : d === "distance" ? " (m)" : ""}`).join(", ")
  );
  line(
    (isEn ? "Target type: " : "Tipo de objetivo: ") +
      TARGET_TYPES.map((t) => {
        const unit = t === "pace" ? "sec/km" : t === "hr" ? "bpm" : t === "power" ? "W" : t === "cadence" ? "rpm" : null;
        return `${TARGET_TYPE_LABEL[t][locale]}${unit ? ` (${unit})` : ""}`;
      }).join(", ")
  );
  line(
    isEn
      ? "Pace target is in seconds per km (e.g. 300 = 5:00/km) — same unit the app's own structured-step editor uses."
      : "El objetivo de pace es en segundos por km (p. ej. 300 = 5:00/km) — la misma unidad que usa el editor de pasos estructurados de la app."
  );

  ws.getColumn(1).alignment = { wrapText: true };
}

/**
 * Three extra sheets carrying every /settings profile field for both
 * athletes — personal info/goal/HR on one row each, personal bests and
 * zone ranges as their own tables (variable-length, so they can't fit a
 * fixed-width profile row). Per explicit instruction: the Weekly Plan
 * Excel is the single file handed to an AI agent, so it has to carry the
 * full triathlete profile alongside the week's workouts, not just a
 * separate export.
 */
function addAthleteProfileSheets(wb: ExcelJS.Workbook, locale: Locale, athletes: AthleteProfileExport[]) {
  const isEn = locale === "en";

  const profile = wb.addWorksheet(isEn ? "Athlete Profile" : "Perfil del Atleta");
  const profileCols = isEn
    ? [
        "Athlete", "Birth date", "Sex", "Height (cm)", "Weight (kg)", "Resting HR (bpm)", "Max HR (bpm)",
        "LTHR (bpm)", "Threshold pace (min/km)", "FTP (W)", "VO2max",
        "Goal race", "Goal race date", "Goal distance", "Goal / target time",
        "Predicted 5K", "Predicted 10K", "Predicted Half Marathon", "Predicted Marathon",
      ]
    : [
        "Atleta", "Fecha de nacimiento", "Sexo", "Estatura (cm)", "Peso (kg)", "FC en reposo (bpm)", "FC máxima (bpm)",
        "LTHR (bpm)", "Pace umbral (min/km)", "FTP (W)", "VO2max",
        "Carrera objetivo", "Fecha de la carrera", "Distancia objetivo", "Objetivo / tiempo meta",
        "5K estimado", "10K estimado", "Media Maratón estimado", "Maratón estimado",
      ];
  profile.columns = profileCols.map((header) => ({ header, width: Math.max(14, header.length + 2) }));
  profile.getRow(1).font = { bold: true };
  profile.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E6" } };

  for (const a of athletes) {
    const predicted = predictRaceTimes(a.personalBests);
    const predictedFor = (key: string) => {
      const p = predicted?.find((x) => x.key === key);
      return p ? durationLabel(p.predictedSec) + (p.fromActual ? ` (${isEn ? "actual" : "real"})` : "") : "";
    };
    profile.addRow([
      a.name,
      a.birthDate ?? "",
      a.sex ?? "",
      a.heightCm ?? "",
      a.weightKg ?? "",
      a.restingHr ?? "",
      a.maxHr ?? "",
      a.thresholdHr ?? "",
      a.thresholdPaceSecPerKm ? `${Math.floor(a.thresholdPaceSecPerKm / 60)}:${String(a.thresholdPaceSecPerKm % 60).padStart(2, "0")}` : "",
      a.ftpWatts ?? "",
      a.vo2max ?? "",
      a.goalRaceName ?? "",
      a.goalRaceDate ?? "",
      a.goalDistance ?? "",
      a.goalNotes ?? "",
      predictedFor("5k"),
      predictedFor("10k"),
      predictedFor("half"),
      predictedFor("marathon"),
    ]);
  }

  const bests = wb.addWorksheet(isEn ? "Personal Bests" : "Mejores Tiempos");
  const bestsCols = isEn
    ? ["Athlete", "Sport", "Distance", "Time", "Date", "Race"]
    : ["Atleta", "Deporte", "Distancia", "Tiempo", "Fecha", "Carrera"];
  bests.columns = bestsCols.map((header) => ({ header, width: Math.max(14, header.length + 2) }));
  bests.getRow(1).font = { bold: true };
  bests.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E6" } };
  for (const a of athletes) {
    for (const pb of a.personalBests) {
      bests.addRow([a.name, SPORT_LABEL[pb.sport]?.[locale] ?? pb.sport, pb.distanceLabel, durationLabel(pb.timeSec), pb.date, pb.raceName]);
    }
  }

  const zones = wb.addWorksheet(isEn ? "Training Zones" : "Zonas de Entrenamiento");
  const zonesCols = isEn
    ? ["Athlete", "Zone system", "Zone", "Range"]
    : ["Atleta", "Sistema de zonas", "Zona", "Rango"];
  zones.columns = zonesCols.map((header) => ({ header, width: Math.max(14, header.length + 2) }));
  zones.getRow(1).font = { bold: true };
  zones.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E6" } };
  for (const a of athletes) {
    if (a.thresholdHr) {
      for (const z of computeHrZones(a.thresholdHr)) {
        zones.addRow([a.name, "HR", ZONE_LABEL[z.key][locale], `${z.min}${z.max ? `-${z.max}` : "+"} bpm`]);
      }
    }
    if (a.thresholdPaceSecPerKm) {
      for (const z of computePaceZones(a.thresholdPaceSecPerKm)) {
        const fast = z.fastSecPerKm ? `${Math.floor(z.fastSecPerKm / 60)}:${String(z.fastSecPerKm % 60).padStart(2, "0")}` : null;
        const slow = z.slowSecPerKm ? `${Math.floor(z.slowSecPerKm / 60)}:${String(z.slowSecPerKm % 60).padStart(2, "0")}` : null;
        const range = fast && slow ? `${fast}-${slow} min/km` : fast ? `< ${fast} min/km` : slow ? `> ${slow} min/km` : "";
        zones.addRow([a.name, isEn ? "Pace" : "Pace", ZONE_LABEL[z.key][locale], range]);
      }
    }
    if (a.ftpWatts) {
      for (const z of computePowerZones(a.ftpWatts)) {
        zones.addRow([a.name, "Power", ZONE_LABEL[z.key][locale], `${z.min}${z.max ? `-${z.max}` : "+"} W`]);
      }
    }
  }
}

export interface ParsedPlanRow {
  rowNumber: number;
  athleteSlug: AthleteSlug;
  date: string;
  sport: Sport;
  start: string | null;
  minutes: number;
  title: string;
  workoutType: string;
  km: number;
  notes: string;
  stravaComment: string;
  done: boolean;
  /** From the Structured Steps sheet, matched by Athlete+Date+Title — see
   * parsePlanWorkbook()'s own comment. Empty array if this workout has
   * no matching step rows (or the sheet is missing entirely). */
  workoutSteps: WorkoutStep[];
}

export interface ParsePlanResult {
  rows: ParsedPlanRow[];
  errors: { rowNumber: number; message: string }[];
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  // Found live (Nov 2026, full codebase audit): a rich-text cell (Excel's
  // real shape for anything pasted with mixed formatting, e.g. from Word
  // or a web page) matched neither the "text" nor "result" check below
  // and fell through to String(v), producing the literal "[object
  // Object]" with no error — directly against this file's own
  // documented "every invalid row is reported, never silently dropped
  // or guessed" guarantee. Checked first since a rich-text cell object
  // doesn't carry "text"/"result" at its own top level.
  if (typeof v === "object" && "richText" in (v as unknown as Record<string, unknown>)) {
    const runs = (v as unknown as { richText: { text?: unknown }[] }).richText;
    return (Array.isArray(runs) ? runs : [])
      .map((r) => String(r?.text ?? ""))
      .join("")
      .trim();
  }
  if (typeof v === "object" && "text" in (v as unknown as Record<string, unknown>)) {
    return String((v as unknown as { text: unknown }).text ?? "").trim();
  }
  if (typeof v === "object" && "result" in (v as unknown as Record<string, unknown>)) {
    return String((v as unknown as { result: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

function cellToDateStr(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  const s = cellToString(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Handles Excel time-of-day cells (Date with the 1899-12-30 epoch), plain "HH:MM" strings, and bare numeric time fractions. */
function cellToTimeStr(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v >= 0 && v < 1) {
    const totalMin = Math.round(v * 24 * 60);
    return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  }
  const s = cellToString(v);
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function matchAthlete(raw: string, roster: { slug: string; name: string }[]): AthleteSlug | null {
  const s = raw.trim().toLowerCase();
  const found = roster.find((a) => a.slug.toLowerCase() === s || a.name.toLowerCase() === s);
  return found?.slug ?? null;
}

function matchStepKind(raw: string): WorkoutStepKind | null {
  const s = raw.trim().toLowerCase();
  for (const kind of STEP_KINDS) {
    if (kind === s || STEP_KIND_LABEL[kind].es.toLowerCase() === s || STEP_KIND_LABEL[kind].en.toLowerCase() === s) return kind;
  }
  return null;
}

function matchTargetType(raw: string): WorkoutStepTargetType | null {
  const s = raw.trim().toLowerCase();
  for (const t of TARGET_TYPES) {
    if (t === s || TARGET_TYPE_LABEL[t].es.toLowerCase() === s || TARGET_TYPE_LABEL[t].en.toLowerCase() === s) return t;
  }
  return null;
}

function newStepId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

type ParsedStepToken = Omit<WorkoutStep, "id">;

/**
 * Parses ONE step token (already split off the `;`-separated
 * Structured Steps cell, already trimmed) against the grammar
 * documented in `addGuideSheet()`'s "Structured Steps" section:
 * `<Kind> <Duration> [x<Repeat>] [@<Target> <Low>[-<High>]]`. Returns
 * `{error}` instead of throwing — the caller attaches the row/step
 * context the raw error message doesn't have.
 */
function parseStepToken(raw: string): ParsedStepToken | { error: string } {
  const atIndex = raw.indexOf("@");
  const main = (atIndex >= 0 ? raw.slice(0, atIndex) : raw).trim();
  const targetPart = atIndex >= 0 ? raw.slice(atIndex + 1).trim() : "";

  const mainWords = main.split(/\s+/).filter(Boolean);
  if (mainWords.length === 0) return { error: "paso vacío" };

  const kind = matchStepKind(mainWords[0]);
  if (!kind) return { error: `tipo de paso no reconocido: "${mainWords[0]}"` };

  let durationType: WorkoutStepDurationType | null = null;
  let durationValue: number | null = null;
  let repeatCount: number | null = null;

  for (const word of mainWords.slice(1)) {
    const repeatMatch = word.match(/^x(\d+)$/i);
    if (repeatMatch) {
      repeatCount = Number(repeatMatch[1]);
      continue;
    }
    const durationMatch = word.match(/^(\d+(?:\.\d+)?)(min|m)$/i);
    if (durationMatch) {
      const value = Number(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      durationType = unit === "min" ? "time" : "distance";
      durationValue = unit === "min" ? Math.round(value * 60) : Math.round(value);
      continue;
    }
    if (/^(open|libre)$/i.test(word)) {
      durationType = "open";
      durationValue = null;
      continue;
    }
    return { error: `no se pudo interpretar "${word}"` };
  }

  if (!durationType) return { error: 'falta la duración (ej. "15min", "400m" o "Open")' };

  let targetType: WorkoutStepTargetType = "open";
  let targetLow: number | null = null;
  let targetHigh: number | null = null;

  if (targetPart) {
    const targetWords = targetPart.split(/\s+/).filter(Boolean);
    const matchedTarget = matchTargetType(targetWords[0] ?? "");
    if (!matchedTarget) return { error: `tipo de objetivo no reconocido: "${targetWords[0] ?? ""}"` };
    targetType = matchedTarget;
    if (targetType !== "open") {
      const rangeWord = targetWords[1];
      if (!rangeWord) return { error: `falta el valor del objetivo para "${targetWords[0]}"` };
      const rangeMatch = rangeWord.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/);
      if (!rangeMatch) return { error: `valor de objetivo inválido: "${rangeWord}"` };
      targetLow = Number(rangeMatch[1]);
      // A single value with no dash mirrors into both ends, per the
      // Guide sheet's own documented rule — matches COROS MCP's own
      // confirmed instruction ("for a single value... set both
      // endpoints to that value; do not widen it into a range").
      targetHigh = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : targetLow;
    }
  }

  return { kind, durationType, durationValue, repeatCount, targetType, targetLow, targetHigh };
}

/**
 * Parses a whole Structured Steps cell — zero or more `;`-separated step
 * tokens — into `WorkoutStep[]`. An empty/blank cell is valid (no
 * structure, same as leaving the WorkoutDialog editor empty) and
 * returns no steps and no errors.
 */
function parseStructuredStepsCell(raw: string): { steps: WorkoutStep[]; errors: string[] } {
  const errors: string[] = [];
  const steps: WorkoutStep[] = [];
  if (!raw.trim()) return { steps, errors };
  const tokens = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  tokens.forEach((token, i) => {
    const parsed = parseStepToken(token);
    if ("error" in parsed) {
      errors.push(`paso ${i + 1} ("${token}"): ${parsed.error}`);
      return;
    }
    steps.push({ id: newStepId(), ...parsed });
  });
  return { steps, errors };
}

function matchSport(raw: string): Sport | null {
  const s = raw.trim().toLowerCase();
  for (const sport of SPORTS) {
    if (sport === s || SPORT_LABEL[sport].es.toLowerCase() === s || SPORT_LABEL[sport].en.toLowerCase() === s) return sport;
  }
  return null;
}

function timeDiffMinutes(start: string, end: string): number | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  // Found live (Nov 2026, full codebase audit): an end time numerically
  // before the start time used to return null unconditionally, so an
  // overnight workout (e.g. 22:00-02:00, a real scenario for long/ultra
  // sessions) silently imported with minutes=0 and no reported error —
  // against this file's own "never silently dropped or guessed"
  // guarantee. Only wraps when end is strictly before start (spanning
  // midnight); start === end (diff 0) stays invalid rather than being
  // read as an implausible 24-hour workout.
  if (diff < 0) diff += 24 * 60;
  return diff > 0 ? diff : null;
}

export async function parsePlanWorkbook(buffer: ArrayBuffer, roster: { slug: string; name: string }[]): Promise<ParsePlanResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const rows: ParsedPlanRow[] = [];
  const errors: { rowNumber: number; message: string }[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const get = (col: number) => row.getCell(col).value;
    const athleteRaw = cellToString(get(1));
    const dateRaw = get(2);
    const sportRaw = cellToString(get(3));
    const titleRaw = cellToString(get(7));
    if (!athleteRaw && !dateRaw && !sportRaw && !titleRaw) return; // skip fully blank row

    const athleteSlug = matchAthlete(athleteRaw, roster);
    const date = cellToDateStr(dateRaw);
    const sport = matchSport(sportRaw);

    if (!athleteSlug) return void errors.push({ rowNumber, message: `Atleta no reconocido: "${athleteRaw}"` });
    if (!date) return void errors.push({ rowNumber, message: `Fecha inválida (usa AAAA-MM-DD): "${cellToString(dateRaw)}"` });
    if (!sport) return void errors.push({ rowNumber, message: `Deporte no reconocido: "${sportRaw}"` });
    if (!titleRaw) return void errors.push({ rowNumber, message: "Falta el título" });

    const start = cellToTimeStr(get(4));
    const end = cellToTimeStr(get(5));
    const minutesCol = Number(cellToString(get(6))) || 0;
    const timeDiff = start && end ? timeDiffMinutes(start, end) : null;
    const minutes = timeDiff ?? minutesCol;
    // Found live (Nov 2026, full codebase audit): a start/end pair
    // timeDiffMinutes rejected (identical times) used to silently fall
    // back to the Minutes column with no reported error — if that
    // column was also left blank (the documented default when using
    // Start/End), the row imported with minutes=0 and nobody was told.
    if (start && end && timeDiff === null && minutesCol === 0) {
      return void errors.push({ rowNumber, message: `Hora inicio y fin inválidas o idénticas ("${start}"-"${end}") y no se indicaron Minutos` });
    }

    const doneRaw = cellToString(get(12)).toLowerCase();
    const done = ["sí", "si", "yes", "true", "1"].includes(doneRaw);

    // Nov 2026, see this file's own header — Structured Steps is one
    // column (13), not a separate sheet; a blank cell is valid (no
    // structure), and any malformed step inside it is reported as its
    // own error tagged with this same row number, never silently
    // dropped or guessed — same discipline every other field here uses.
    const { steps: workoutSteps, errors: stepErrors } = parseStructuredStepsCell(cellToString(get(13)));
    stepErrors.forEach((message) => errors.push({ rowNumber, message: `Pasos Estructurados: ${message}` }));

    rows.push({
      rowNumber,
      athleteSlug,
      date,
      sport,
      start,
      minutes,
      title: titleRaw,
      workoutType: cellToString(get(8)),
      km: Number(cellToString(get(9))) || 0,
      notes: cellToString(get(10)),
      stravaComment: cellToString(get(11)),
      done,
      workoutSteps,
    });
  });

  return { rows, errors };
}
