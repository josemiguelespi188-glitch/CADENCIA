import type { WorkoutWithSlug } from "@/components/WorkoutDialog";
import type { Athlete } from "@/lib/types";
import { parseYmd, pad } from "@/lib/dates";
import { assignDefaultStartTimes } from "@/lib/scheduling";

function icsEscape(s: string) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** iCalendar requires lines no longer than 75 octets — folds with a leading space on the continuation. */
function fold(line: string) {
  let out = "";
  let rest = line;
  while (rest.length > 74) {
    out += rest.slice(0, 74) + "\r\n ";
    rest = rest.slice(74);
  }
  return out + rest;
}

function stamp(d: Date, time?: { h: number; m: number }) {
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  if (!time) return datePart;
  return `${datePart}T${pad(time.h)}${pad(time.m)}00`;
}

/**
 * Builds one .ics file's text for the given workouts. Each workout's `id`
 * becomes the event's UID, so re-downloading the same week after an edit
 * updates the existing calendar event on re-import instead of duplicating
 * it (see CLAUDE.md's "Weekly .ics export" section for the full rationale).
 */
export function buildWeekIcs(
  workouts: WorkoutWithSlug[],
  athleteBySlug: Record<string, Athlete>,
  isMultiple: boolean,
  sportLabel: (sport: string) => string
): string {
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(
    now.getUTCHours()
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cadencia//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Cadencia"];

  // Nov 2026, direct instruction: "todos los entrenos tiene que tener
  // una hora para poner en el calendario" — every exported workout is
  // now a real timed event, never an all-day placeholder. A workout
  // created after the scheduling fix above already carries a real
  // `start`; this fallback only matters for older/bulk-inserted rows
  // that still don't. See lib/scheduling.ts.
  const startTimes = assignDefaultStartTimes(workouts);

  for (const w of workouts) {
    const d = parseYmd(w.date);
    const effectiveStart = startTimes.get(w.id) ?? "06:00";
    const [h, m] = effectiveStart.split(":").map(Number);
    const startStamp = stamp(d, { h, m });
    const endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m + (w.minutes || 60));
    const endStamp = stamp(endDate, { h: endDate.getHours(), m: endDate.getMinutes() });

    lines.push("BEGIN:VEVENT", `UID:${w.id}@cadencia`, `DTSTAMP:${dtstamp}`, `DTSTART:${startStamp}`, `DTEND:${endStamp}`);

    const prefix = isMultiple ? `[${athleteBySlug[w.athleteSlug]?.initials ?? "?"}] ` : "";
    lines.push(`SUMMARY:${icsEscape(`${prefix}${sportLabel(w.sport)}: ${w.title}`)}`);

    const descParts = [w.notes, w.km ? `${w.km} km` : ""].filter(Boolean);
    if (descParts.length) lines.push(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
