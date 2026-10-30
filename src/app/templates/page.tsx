"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { SPORTS, type Sport, type Template } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY = { sport: "run" as Sport, title: "", minutes: 0, km: 0, notes: "" };

export default function TemplatesPage() {
  const { t } = useLocale();
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<{ record: Template | null } | null>(null);
  const [value, setValue] = useState(EMPTY);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("templates").select("*").order("sport");
    setTemplates((data as Template[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push("/auth");
        return;
      }
      setCheckingAuth(false);
      load();
    });
  }, [router, load]);

  useEffect(() => {
    if (!editing) {
      dialogRef.current?.close();
      return;
    }
    // Syncing local form state to the `editing` prop — see the same note in
    // WorkoutDialog.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(
      editing.record
        ? { sport: editing.record.sport, title: editing.record.title, minutes: editing.record.minutes, km: editing.record.km, notes: editing.record.notes }
        : EMPTY
    );
    dialogRef.current?.showModal();
  }, [editing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (editing?.record) {
      await supabase.from("templates").update(value).eq("id", editing.record.id);
    } else {
      await supabase.from("templates").insert(value);
    }
    setEditing(null);
    await load();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("templates").delete().eq("id", id);
    setEditing(null);
    await load();
  }

  if (checkingAuth) return null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("tpl_h")}</h1>
              <p className="text-sm text-ink-3">{t("tpl_sub")}</p>
            </div>
            <Button size="sm" className="ml-auto" onClick={() => setEditing({ record: null })}>
              + {t("new_t")}
            </Button>
          </div>

          {loading ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center text-ink-3">{t("empty_tpl")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className={cn("s-" + tpl.sport, "flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4")}>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--c)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--c)" }} />
                    {t(tpl.sport)}
                    {tpl.minutes ? ` · ${tpl.minutes} min` : ""}
                    {tpl.km ? ` · ${tpl.km} km` : ""}
                  </span>
                  <h4 className="font-semibold">{tpl.title}</h4>
                  {tpl.notes && <p className="flex-1 text-sm text-ink-2">{tpl.notes}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ record: tpl })}>
                      {t("edit")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <dialog
        ref={dialogRef}
        onClose={() => setEditing(null)}
        className="rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/50 w-[min(480px,calc(100vw-24px))]"
      >
        <form onSubmit={save} className="flex flex-col gap-4 p-6">
          <h2 className="text-xl font-semibold tracking-tight">{editing?.record ? t("edit_t") : t("new_t")}</h2>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{t("sport")}</label>
            <select
              value={value.sport}
              onChange={(e) => setValue((v) => ({ ...v, sport: e.target.value as Sport }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{t("title")}</label>
            <input
              required
              value={value.title}
              onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-2">{t("min")}</label>
              <input
                type="number"
                min={0}
                value={value.minutes}
                onChange={(e) => setValue((v) => ({ ...v, minutes: Number(e.target.value) || 0 }))}
                className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-2">{t("km")}</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={value.km}
                onChange={(e) => setValue((v) => ({ ...v, km: Number(e.target.value) || 0 }))}
                className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{t("notes")}</label>
            <textarea
              value={value.notes}
              onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))}
              className="min-h-20 resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {editing?.record && (
              <Button type="button" variant="danger" size="sm" onClick={() => editing.record && remove(editing.record.id)}>
                {t("del")}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm">
                {t("save")}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </div>
  );
}
