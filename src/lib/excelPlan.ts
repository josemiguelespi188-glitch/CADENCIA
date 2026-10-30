import ExcelJS from "exceljs";
import { ATHLETES, SPORTS, type AthleteSlug, type Sport } from "@/lib/types";

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

export async function buildPlanTemplate(locale: Locale = "es"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(locale === "en" ? "Plan" : "Plan");
  const cols = COLS(locale);

  ws.columns = cols.map((header) => ({ header, width: Math.max(16, header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9E6" } };

  const athleteNames = (Object.keys(ATHLETES) as AthleteSlug[]).map((s) => ATHLETES[s].name);
  const sportNames = SPORTS.map((s) => SPORT_LABEL[s][locale]);
  const doneOptions = locale === "en" ? ["Yes", "No"] : ["Sí", "No"];

  // One example row, left in on purpose as a visible reference — added
  // BEFORE the data-validation loop below, so it lands on row 2 (setting
  // dataValidation on a cell materializes that row, which would otherwise
  // push addRow()'s result past all of them).
  ws.addRow([
    athleteNames[0],
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
          "One row per workout. Delete the example row (row 2) before uploading, or leave it — it will just create one more workout.",
          "Athlete / Sport / Done have dropdowns — pick from the list so the import can match them.",
          "Give either Start time + End time, OR just Minutes — not both. Times win if both are present.",
          "Date must be YYYY-MM-DD.",
          "Notes is the internal objective; Strava comment is written verbatim onto the Strava activity once it's matched (leave blank to let the AI draft one instead).",
        ]
      : [
          "Una fila por entreno. Borra la fila de ejemplo (fila 2) antes de subir, o déjala — solo va a crear un entreno más.",
          "Atleta / Deporte / Hecho tienen listas desplegables — elige de ahí para que la importación los reconozca.",
          "Pon Hora inicio + Hora fin, O solo Minutos — no hace falta ambos. Si pones las dos horas, esas mandan sobre Minutos.",
          "La fecha debe ir como AAAA-MM-DD.",
          "Notas es el objetivo interno; Comentario para Strava se escribe tal cual en la actividad de Strava una vez que se vincule (déjalo vacío para que la IA redacte uno).",
        ];
  lines.forEach((l) => notes.addRow([l]));
  notes.getColumn(1).alignment = { wrapText: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
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

function matchAthlete(raw: string): AthleteSlug | null {
  const s = raw.trim().toLowerCase();
  for (const slug of Object.keys(ATHLETES) as AthleteSlug[]) {
    if (slug === s || ATHLETES[slug].name.toLowerCase() === s) return slug;
  }
  return null;
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
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

export async function parsePlanWorkbook(buffer: ArrayBuffer): Promise<ParsePlanResult> {
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

    const athleteSlug = matchAthlete(athleteRaw);
    const date = cellToDateStr(dateRaw);
    const sport = matchSport(sportRaw);

    if (!athleteSlug) return void errors.push({ rowNumber, message: `Atleta no reconocido: "${athleteRaw}"` });
    if (!date) return void errors.push({ rowNumber, message: `Fecha inválida (usa AAAA-MM-DD): "${cellToString(dateRaw)}"` });
    if (!sport) return void errors.push({ rowNumber, message: `Deporte no reconocido: "${sportRaw}"` });
    if (!titleRaw) return void errors.push({ rowNumber, message: "Falta el título" });

    const start = cellToTimeStr(get(4));
    const end = cellToTimeStr(get(5));
    const minutesCol = Number(cellToString(get(6))) || 0;
    const minutes = start && end ? (timeDiffMinutes(start, end) ?? minutesCol) : minutesCol;

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
