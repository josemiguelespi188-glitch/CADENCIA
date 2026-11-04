"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SPORTS, type Sport } from "@/lib/types";
import { today, ymd } from "@/lib/dates";

/**
 * "Crear comunidades + asignar el mismo entreno a todos de una vez" —
 * the other half of what being a coach unlocks (Community Phase 2, see
 * CLAUDE.md's "Community" section). Deliberately simpler than
 * WorkoutDialog — no structured steps here, since the per-step HR/pace/
 * power zone quick-pick is resolved against ONE athlete's own thresholds
 * and wouldn't make sense applied blindly across a whole roster with
 * different zones. Inserts one plain `workouts` row per member,
 * `done: false`; each athlete can add their own structure/comment
 * afterward from their own calendar like any other workout.
 */
export function AssignCommunityWorkoutDialog({
  memberIds,
  onClose,
  onAssigned,
}: {
  memberIds: string[];
  onClose: () => void;
  onAssigned: (count: number) => void;
}) {
  const { locale, t } = useLocale();
  const isEn = locale === "en";
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [sport, setSport] = useState<Sport>("run");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(ymd(today()));
  const [minutes, setMinutes] = useState("");
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same bounding-rect click-outside check every other dialog in this app
  // uses — a backdrop click still targets the <dialog> element itself, so
  // e.target identity alone can't tell an outside click from an inside one.
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(isEn ? "Title is required." : "El título es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const rows = memberIds.map((athlete_id) => ({
      athlete_id,
      date,
      sport,
      title: title.trim(),
      minutes: minutes ? Number(minutes) : 0,
      km: km ? Number(km) : 0,
      notes,
    }));
    const { error: insertError } = await supabase.from("workouts").insert(rows);
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onAssigned(rows.length);
  }

  return (
    <dialog
      ref={dialogRef}
      open
      onClick={handleDialogClick}
      className="m-auto w-full max-w-md rounded-2xl border border-line bg-surface p-0 backdrop:bg-ink/40"
    >
      <form onSubmit={submit} className="flex max-h-[calc(100dvh-24px)] flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{isEn ? "Assign a workout to everyone" : "Asignar un entreno a todos"}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="close">
            ×
          </button>
        </div>
        <p className="text-xs text-ink-3">
          {isEn
            ? `This creates one workout for each of this community's ${memberIds.length} member(s), on the same date.`
            : `Esto crea un entreno para cada uno de los ${memberIds.length} miembro(s) de esta comunidad, en la misma fecha.`}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{isEn ? "Sport" : "Deporte"}</label>
            <select value={sport} onChange={(e) => setSport(e.target.value as Sport)} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm">
              {SPORTS.filter((s) => s !== "race").map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{isEn ? "Date" : "Fecha"}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{isEn ? "Title" : "Título"}</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">{isEn ? "Minutes" : "Minutos"}</label>
            <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">Km</label>
            <input type="number" min={0} step={0.1} value={km} onChange={(e) => setKm(e.target.value)} className="h-10 rounded-xl border border-line bg-bg px-3 text-sm" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{isEn ? "Notes (the workout's purpose)" : "Notas (el objetivo del entreno)"}</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl border border-line bg-bg p-3 text-sm" />
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {isEn ? "Cancel" : "Cancelar"}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? (isEn ? "Assigning…" : "Asignando…") : isEn ? "Assign to everyone" : "Asignar a todos"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
