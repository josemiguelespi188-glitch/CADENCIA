import { NextRequest, NextResponse } from "next/server";
import { buildPlanTemplate, type AthleteProfileExport } from "@/lib/excelPlan";
import { createServiceClient } from "@/lib/supabase/server";
import { getSignedInAthlete } from "@/lib/auth";
import type { Athlete } from "@/lib/types";

/**
 * Found live (Nov 2026, full codebase audit): this route had NO auth
 * check at all — it reads every athlete's row with the service-role
 * client (birth date, resting/max HR, goal race, personal bests) and
 * returned it to anyone who hit the URL, signed in or not. Gated the
 * same way every other non-admin route in this app is — any signed-in
 * athlete, not requireAdmin() — since the Weekly Plan Excel is a
 * shared-coach-log tool any athlete can already use from /templates.
 */
export async function GET(req: NextRequest) {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "es";

  const db = createServiceClient();
  const { data } = await db.from("athletes").select("*");
  const athletes: AthleteProfileExport[] = ((data as Athlete[]) ?? []).map((a) => ({
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
  }));

  const buf = await buildPlanTemplate(locale, athletes);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cadencia-plan-${locale}.xlsx"`,
    },
  });
}
