"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ImportResult {
  inserted: number;
  errors: { rowNumber: number; message: string }[];
}

/**
 * The weekly-plan Excel template + importer — "de aquí va a salir al
 * calendario": download the template, fill every workout for the week
 * (times, notes, the Strava comment), upload it back, and every row
 * becomes a real workouts row immediately visible on the calendar. Lives
 * on the Generate page now, not Calendar — see CLAUDE.md's "Rename
 * Templates to Generate" note — so a successful import's `onImported`
 * callback has nothing to refresh here; Calendar picks up the new rows
 * the next time it's visited (it fetches fresh on every mount).
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
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{t("plan_import_h")}</h3>
        <p className="text-xs text-ink-3">
          {isEn ? "Download the template, fill in the week, upload it back." : "Descarga la plantilla, llena la semana, súbela de vuelta."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/plan/template?locale=${locale}`}>
          <Button variant="steel" size="sm">
            {t("download_template")}
          </Button>
        </a>
        <Button variant="steel" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? t("importing") : t("upload_excel")}
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} hidden />
      </div>

      {result && (
        <div className="text-xs">
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
    </Card>
  );
}
