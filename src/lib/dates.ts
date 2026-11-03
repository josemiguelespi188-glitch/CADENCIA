export const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

export const monday = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

export const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

export const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

export function hm(minutes: number, locale: "es" | "en" = "es") {
  const m = Math.round(minutes || 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  const minLabel = locale === "en" ? "min" : "min";
  if (!h) return `${r} ${minLabel}`;
  return `${h} h${r ? ` ${r} ${minLabel}` : ""}`;
}

export const hrs = (minutes: number) => minutes / 60;

/** Formats a pace in seconds/km as "M:SS/km". Returns "" for null/0. */
export function paceLabel(secPerKm: number | null) {
  if (!secPerKm) return "";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${pad(s)}/km`;
}

/** Parses "M:SS" (or "MM:SS") into total seconds, or null if not a valid pace. */
export function parsePace(min: string, sec: string): number | null {
  // Found live (Nov 2026, full codebase audit): Number("") is 0, not
  // NaN — a blank field used to be silently treated as "0" rather than
  // "not entered." Checked explicitly here rather than relying on the
  // m===0&&s===0 guard below, which only ever caught the case where
  // BOTH fields were blank — leaving minutes blank while typing only
  // seconds (e.g. "42") used to save an impossible pace instead of
  // being rejected.
  if (min.trim() === "" || sec.trim() === "") return null;
  const m = Number(min);
  const s = Number(sec);
  if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s >= 60) return null;
  if (m === 0 && s === 0) return null;
  return m * 60 + s;
}

export function fmt(d: Date, locale: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

/** Parses H/M/S fields (any may be "") into total seconds, or null if nothing valid was entered. */
export function parseDuration(h: string, m: string, s: string): number | null {
  const hh = Number(h || 0);
  const mm = Number(m || 0);
  const ss = Number(s || 0);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  const total = hh * 3600 + mm * 60 + ss;
  return total > 0 ? total : null;
}

/** Formats a duration in seconds as "H:MM:SS" (or "M:SS" under an hour). */
export function durationLabel(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
