import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parsePlanWorkbook } from "@/lib/excelPlan";
import { getSignedInAthlete } from "@/lib/auth";

/**
 * Bulk-creates workouts from an uploaded plan spreadsheet. Always
 * INSERTS — it never tries to match/update an existing workout, so
 * re-uploading the same file twice creates duplicates. Keep it simple:
 * this is meant for loading a week once; edit duplicates away in the
 * calendar UI if it happens. See CLAUDE.md's "Excel weekly-plan import"
 * section.
 *
 * Found live (Nov 2026, full codebase audit): this route had NO auth
 * check — an anonymous POST could insert arbitrary workouts rows for
 * any athlete slug in the roster. Gated the same way every other
 * non-admin route in this app is.
 */
export async function POST(req: NextRequest) {
  const athlete = await getSignedInAthlete();
  if (!athlete) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: athletes } = await db.from("athletes").select("id, slug, name");
  const roster = (athletes ?? []).map((a) => ({ slug: a.slug, name: a.name }));
  const athleteIdBySlug = new Map((athletes ?? []).map((a) => [a.slug, a.id]));

  const buffer = await file.arrayBuffer();
  const { rows, errors } = await parsePlanWorkbook(buffer, roster);

  const payload = rows.map((r) => ({
    athlete_id: athleteIdBySlug.get(r.athleteSlug),
    date: r.date,
    sport: r.sport,
    title: r.title,
    workout_type: r.workoutType,
    start: r.start,
    minutes: r.minutes,
    km: r.km,
    notes: r.notes,
    strava_comment: r.stravaComment,
    done: r.done,
  }));

  let inserted = 0;
  if (payload.length) {
    const { error, count } = await db.from("workouts").insert(payload, { count: "exact" });
    if (error) return NextResponse.json({ error: error.message, errors }, { status: 500 });
    inserted = count ?? payload.length;
  }

  return NextResponse.json({ ok: true, inserted, errors });
}
