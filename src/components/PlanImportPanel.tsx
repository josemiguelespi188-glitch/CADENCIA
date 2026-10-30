"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

interface ImportResult {
  inserted: number;
  errors: { rowNumber: number; message: string }[];
}

/**
 * The weekly-plan Excel template + importer — "de aquí va a salir al
 * calendario": download the template, fill every workout for the week
 * (times, notes, the Strava comment), upload it back, and every row
 * becomes a real workouts row immediately visible on the calendar. See
 * CLAUDE.md's "Excel weekly-plan import" section and lib/excelPlan.ts.
 */
export function PlanImportPanel({ onImported }: { onImported: () => void }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/plan/import", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setResult({ inserted: data.inserted, errors: data.errors ?? [] });
        if (data.inserted > 0) onImported();
      } else {
        setResult({ inserted: 0, errors: [{ rowNumber: 0, message: data.error ?? "Error" }] });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line p-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">{t("plan_import_h")}</span>
      <a href={`/api/plan/template?locale=${locale}`}>
        <Button variant="steel" size="sm">
          {t("download_template")}
        </Button>
      </a>
      <Button variant="steel" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? t("importing") : t("upload_excel")}
      </Button>
      <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} hidden />

      {result && (
        <div className="w-full text-xs">
          {result.inserted > 0 && <p className="text-success">{t("import_done", { n: result.inserted })}</p>}
          {result.errors.length > 0 && (
            <div className="mt-1 text-ink-2">
              <p className="font-medium">{t("import_errors", { n: result.errors.length })}</p>
              <ul className="ml-4 list-disc">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    {isEn ? "Row" : "Fila"} {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
