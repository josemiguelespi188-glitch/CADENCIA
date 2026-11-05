"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dayDiff, parseYmd, today, ymd } from "@/lib/dates";
import type { Community } from "@/lib/types";

/**
 * Countdown/progress bar toward a community's target event, plus the
 * coach/admin's own date editor (Nov 2026, see CLAUDE.md's "Community
 * event countdown" section) — direct request: "Débería haber una barra
 * the timing para calcular cuando es el evento de la comunidad por el
 * cual se esta entrenando." Confirmed via AskUserQuestion: the coach
 * sets both dates manually, never auto-derived.
 */
export function CommunityCountdown({
  community,
  isCoachOrAdmin,
  isEn,
  onUpdated,
}: {
  community: Community;
  isCoachOrAdmin: boolean;
  isEn: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [trainingStart, setTrainingStart] = useState(community.training_start_date ?? "");
  const [eventDate, setEventDate] = useState(community.event_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("communities")
      .update({
        training_start_date: trainingStart || null,
        event_date: eventDate || null,
      })
      .eq("id", community.id);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setEditing(false);
    await onUpdated();
  }

  if (!community.training_start_date && !community.event_date && !isCoachOrAdmin) return null;

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm uppercase tracking-widest text-ink-3">{isEn ? "Event countdown" : "Cuenta atrás del evento"}</h3>
        {isCoachOrAdmin && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {isEn ? "Edit dates" : "Editar fechas"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {isEn ? "Training start" : "Inicio de entrenamiento"}
            <input
              type="date"
              value={trainingStart}
              onChange={(e) => setTrainingStart(e.target.value)}
              className="h-9 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            {isEn ? "Event date" : "Fecha del evento"}
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="h-9 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </label>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (isEn ? "Saving…" : "Guardando…") : isEn ? "Save" : "Guardar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            {isEn ? "Cancel" : "Cancelar"}
          </Button>
          {error && <p className="w-full text-xs text-error">{error}</p>}
        </div>
      ) : community.training_start_date || community.event_date ? (
        <CountdownBar community={community} isEn={isEn} />
      ) : (
        <p className="mt-2 text-sm text-ink-3">
          {isEn ? "No dates set yet for this community's training block." : "Todavía no hay fechas definidas para este bloque de entrenamiento."}
        </p>
      )}
    </Card>
  );
}

function CountdownBar({ community, isEn }: { community: Community; isEn: boolean }) {
  const start = community.training_start_date ? parseYmd(community.training_start_date) : null;
  const event = community.event_date ? parseYmd(community.event_date) : null;
  const now = today();

  const daysToEvent = event ? dayDiff(now, event) : null;
  const totalDays = start && event ? Math.max(1, dayDiff(start, event)) : null;
  const elapsedDays = start ? Math.max(0, dayDiff(start, now)) : null;
  const pct = totalDays !== null && elapsedDays !== null ? Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100)) : null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-ink-2">
        <span>{start ? ymd(start) : isEn ? "No start date" : "Sin fecha de inicio"}</span>
        <span className="font-medium text-ink">
          {daysToEvent === null
            ? isEn
              ? "No event date"
              : "Sin fecha de evento"
            : daysToEvent > 0
              ? isEn
                ? `${daysToEvent} day(s) to go`
                : `Faltan ${daysToEvent} día(s)`
              : daysToEvent === 0
                ? isEn
                  ? "Event day!"
                  : "¡Día del evento!"
                : isEn
                  ? "Event has passed"
                  : "El evento ya pasó"}
        </span>
        <span>{event ? ymd(event) : isEn ? "No event date" : "Sin fecha de evento"}</span>
      </div>
      {pct !== null && (
        <div className="mt-2 h-2.5 rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
