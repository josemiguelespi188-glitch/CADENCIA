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

export function fmt(d: Date, locale: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, opts).format(d);
}
