import ExcelJS from "exceljs";
import { SPORTS, type AthleteSlug, type PersonalBest, type Sport } from "@/lib/types";
import { durationLabel } from "@/lib/dates";
import { predictRaceTimes } from "@/lib/racePredictor";
import { computeHrZones, computePaceZones, computePowerZones, type ZoneKey } from "@/lib/zones";

/**
 * The weekly-plan Excel template — download it, fill it out (any number
 * of rows, any week), upload it back on /calendar to bulk-create every
 * workout at once. Per explicit instruction, it carries EVERYTHING a
 * workout needs: who, when (start/end time so the calendar event's exact
 * window is unambiguous), what, and both the internal notes AND the
 * separate Strava-bound comment. See CLAUDE.md's "Excel weekly-plan
 * import" section for the full rationale.
 */

const SPORT_LABEL: Record<Sport, { es: string; en: string }> = {
  swim: { es: "Natación", en: "Swim" },
  bike: { es: "Bici", en: "Bike" },
  run: { es: "Correr", en: "Run" },
  gym: { es: "Gimnasio", en: "Gym" },
  race: { es: "Carrera", en: "Race" },
};

type Locale = "es" | "en";

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
        "Strava comment",
        "Done (Yes/No)",
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
        "Comentario para Strava",
        "Hecho (Sí/No)",
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
  // push addRow()'s result past all of them).
  ws.addRow([
    athleteNames[0] ?? "",
    "2026-11-03",
    sportNames[2],
    "06:00",
    "07:00",
    "",
    locale === "en" ? "Easy run" : "Rodaje suave",
    locale === "en" ? "Easy" : "Rodaje",
    10,
    locale === "en" ? "Zone 2, conversational pace." : "Zona 2, ritmo conversacional.",
    locale === "en" ? "Easy 10K to open the week." : "Rodaje de 10K para abrir la semana.",
    doneOptions[1],
  ]);
  ws.getRow(2).font = { italic: true, color: { argb: "FF8A8B8E" } };

  const LAST_ROW = 200;
  for (let r = 2; r <= LAST_ROW; r++) {
    ws.getCell(`A${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${athleteNames.join(",")}"`] };
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${sportNames.join(",")}"`] };
    ws.getCell(`L${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${doneOptions.join(",")}"`] };
  }

  const notes = wb.addWorksheet(locale === "en" ? "Notes" : "Notas");
  notes.columns = [{ width: 100 }];
  const lines =
    locale === "en"
      ? [
          "One row per workout. Delete the example row (row 2) before uploading, or leave it: it will just create one more workout.",
          "Athlete / Sport / Done have dropdowns, pick from the list so the import can match them.",
          "Give either Start time + End time, OR just Minutes, not both. Times win if both are present.",
          "Date must be YYYY-MM-DD.",
          "Notes is the internal objective; Strava comment is written verbatim onto the Strava activity once it's matched (leave blank to let the AI draft one instead).",
        ]
      : [
          "Una fila por entreno. Borra la fila de ejemplo (fila 2) antes de subir, o déjala: solo va a crear un entreno más.",
          "Atleta / Deporte / Hecho tienen listas desplegables, elige de ahí para que la importación los reconozca.",
          "Pon Hora inicio + Hora fin, O solo Minutos, no hace falta ambos. Si pones las dos horas, esas mandan sobre Minutos.",
          "La fecha debe ir como AAAA-MM-DD.",
          "Notas es el objetivo interno; Comentario para Strava se escribe tal cual en la actividad de Strava una vez que se vincule (déjalo vacío para que la IA redacte uno).",
        ];
  lines.forEach((l) => notes.addRow([l]));
  notes.getColumn(1).alignment = { wrapText: true };

  if (athletes.length) {
    addAthleteProfileSheets(wb, locale, athletes);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
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
    });
  });

  return { rows, errors };
}
