import { NextRequest, NextResponse } from "next/server";
import { buildPlanTemplate, type AthleteProfileExport } from "@/lib/excelPlan";
import { createServiceClient } from "@/lib/supabase/server";
import { getSignedInAthlete } from "@/lib/auth";
import type { Athlete } from "@/lib/types";

function toExport(a: Athlete): AthleteProfileExport {
  return {
    slug: a.slug,
    name: a.name,
    birthDate: a.birth_date,
    sex: a.sex,
    heightCm: a.height_cm,
    weightKg: a.weight_kg,
    restingHr: a.resting_hr,
    maxHr: a.max_hr,
    thresholdHr: a.threshold_hr,
    thresholdPaceSecPerKm: a.threshold_pace_sec_per_km,
    ftpWatts: a.ftp_watts,
    vo2max: a.vo2max,
    goalRaceName: a.goal_race_name,
    goalRaceDate: a.goal_race_date,
    goalDistance: a.goal_distance,
    goalNotes: a.goal_notes,
    personalBests: a.personal_bests ?? [],
  };
}

/**
 * Found live (Nov 2026, full codebase audit): this route had NO auth
 * check at all — it reads every athlete's row with the service-role
 * client (birth date, resting/max HR, goal race, personal bests) and
 * returned it to anyone who hit the URL, signed in or not. Gated the
 * same way every other non-admin route in this app is — any signed-in
 * athlete, not requireAdmin() — since the Weekly Plan Excel is a
 * shared-coach-log tool any athlete can already use from /templates.
 *
 * **Scoped to exactly one athlete per download (Nov 2026)** — direct
 * complaint: "este excel es por usuario. no puede venir información de
 * juan. solo tiene que venir de mike porque descargue de la cuenta de
 * mike." It used to dump every athlete's full profile (and offer every
 * athlete in the Plan sheet's own dropdown) into one file regardless of
 * who downloaded it. Defaults to the SIGNED-IN caller's own athlete;
 * `?athlete=<slug>` scopes it to a different, explicitly named athlete
 * instead — the path `/community/[slug]/member/[athleteId]` uses (see
 * CLAUDE.md's "Weekly Plan Excel" section): "en community siendo coach
 * si veo el perfil de juanes y quiero editar sus entrenos, debería
 * poder descargar su excel." No extra permission gate beyond being
 * signed in — any signed-in athlete can already view/edit any other
 * athlete's full profile and workouts (the "shared coach log" model
 * documented throughout this codebase), so downloading their prefilled
 * Excel is consistent with permissions that already exist, not a new
 * one.
 */
export async function GET(req: NextRequest) {
  const caller = await getSignedInAthlete();
  if (!caller) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "es";
  const requestedSlug = req.nextUrl.searchParams.get("athlete");

  const db = createServiceClient();
  const { data } = await db.from("athletes").select("*");
  const roster = (data as Athlete[]) ?? [];
  const target = requestedSlug ? roster.find((a) => a.slug === requestedSlug) : roster.find((a) => a.id === caller.id);
  if (!target) return NextResponse.json({ error: "Athlete not found." }, { status: 404 });

  const buf = await buildPlanTemplate(locale, [toExport(target)]);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cadencia-plan-${target.slug}-${locale}.xlsx"`,
    },
  });
}
