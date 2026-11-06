"use client";

import { use } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ZoneTables } from "@/components/ZoneTables";
import { StravaTotals } from "@/components/StravaTotals";
import { predictRaceTimes } from "@/lib/racePredictor";
import { durationLabel } from "@/lib/dates";

/**
 * "Husmear el perfil de la otra persona" — Community Phase 2 (see
 * CLAUDE.md's "Community" section). A read-only mirror of a slice of
 * AthleteProfileCard/ZoneTables/StravaTotals — same data, no edit
 * controls, since this is someone else's profile. Reachable from any
 * community's roster, not membership-gated (same "not gated for viewing"
 * choice Phase 1 made for the roster itself).
 */
export default function CommunityMemberProfilePage({ params }: { params: Promise<{ slug: string; athleteId: string }> }) {
  const { slug, athleteId } = use(params);
  const { locale } = useLocale();
  const isEn = locale === "en";
  const { athletes } = useAuth();

  const athlete = athletes.find((a) => a.id === athleteId);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-3xl">
          <Link href={`/community/${slug}`} className="mb-4 inline-block text-xs text-ink-3 hover:text-ink">
            ← {isEn ? "Back to community" : "Volver a la comunidad"}
          </Link>

          {!athlete ? (
            <p className="text-sm text-ink-2">{isEn ? "Athlete not found." : "Atleta no encontrado."}</p>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-bg">{athlete.initials}</span>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{athlete.name}</h1>
                    {athlete.goal_race_name && (
                      <p className="text-xs text-ink-3">
                        {isEn ? "Training for" : "Entrenando para"} {athlete.goal_race_name}
                        {athlete.goal_race_date ? ` · ${athlete.goal_race_date}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Nov 2026, direct request: "en community siendo coach si
                      veo el perfil de juanes y quiero editar sus entrenos,
                      debería poder descargar su excel." Scoped to this one
                      athlete only (?athlete=<slug>) — see the ?athlete param
                      on GET /api/plan/template. No extra permission check
                      here: any signed-in athlete can already view/edit any
                      other athlete's workouts (the "shared coach log" model),
                      so downloading their prefilled Excel is consistent with
                      permissions that already exist. */}
                  <a href={`/api/plan/template?locale=${locale}&athlete=${athlete.slug}`}>
                    <Button variant="steel" size="sm">
                      {isEn ? "Download Excel" : "Descargar Excel"}
                    </Button>
                  </a>
                  <Link href={`/community/${slug}/compare?with=${athlete.id}`}>
                    <Button size="sm">{isEn ? "Compare" : "Comparar"}</Button>
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <Card>
                  <CardTitle>{isEn ? "Basics" : "Datos básicos"}</CardTitle>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Fact label={isEn ? "Resting HR" : "FC reposo"} value={athlete.resting_hr ? `${athlete.resting_hr} bpm` : "–"} />
                    <Fact label={isEn ? "Max HR" : "FC máxima"} value={athlete.max_hr ? `${athlete.max_hr} bpm` : "–"} />
                    <Fact label="VO2max" value={athlete.garmin_vo2max ?? athlete.vo2max ? `${(athlete.garmin_vo2max ?? athlete.vo2max)} ml/kg/min` : "–"} />
                    <Fact label={isEn ? "Height / weight" : "Altura / peso"} value={athlete.height_cm || athlete.weight_kg ? `${athlete.height_cm ?? "–"} cm · ${athlete.weight_kg ?? "–"} kg` : "–"} />
                  </div>
                  {/* Found live (Nov 2026, direct feedback: "se ve feo esto") —
                      this used to render as a bare, unlabeled line of text
                      floating right under the stat grid with no visual
                      relationship to anything (e.g. a goal time like "4:50"
                      looked like a stray leftover fragment). A divider +
                      an explicit "Goal:" label fixes that. */}
                  {athlete.goal_notes && (
                    <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
                      <span className="font-semibold text-ink">{isEn ? "Goal: " : "Objetivo: "}</span>
                      {athlete.goal_notes}
                    </p>
                  )}
                </Card>

                {athlete.personal_bests.length > 0 && (
                  <Card>
                    <CardTitle>{isEn ? "Personal bests" : "Mejores marcas"}</CardTitle>
                    <div className="mt-3 flex flex-col divide-y divide-line">
                      {athlete.personal_bests.map((pb) => (
                        <div key={pb.id} className="flex items-center justify-between py-2 text-sm">
                          <span className="font-medium">
                            {pb.distanceLabel} <span className="text-xs text-ink-3">({pb.sport})</span>
                          </span>
                          <span className="tabular-nums text-ink-2">{durationLabel(pb.timeSec)}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <RacePredictorCard athlete={athlete} isEn={isEn} />

                <ZoneTables athlete={athlete} />

                <StravaTotals athlete={athlete} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function RacePredictorCard({ athlete, isEn }: { athlete: import("@/lib/types").Athlete; isEn: boolean }) {
  const predicted = predictRaceTimes(athlete.personal_bests);
  if (!predicted) return null;
  return (
    <Card>
      <CardTitle>{isEn ? "Race predictor" : "Predictor de carrera"}</CardTitle>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {predicted.map((p) => (
          <div key={p.key}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{p.label}</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums">{durationLabel(p.predictedSec)}</p>
            <p className="text-[10px] text-ink-3">{p.fromActual ? (isEn ? "actual" : "real") : (isEn ? "estimated" : "estimado")}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
