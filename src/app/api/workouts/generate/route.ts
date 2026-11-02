import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { generateWorkoutFromPrompt } from "@/lib/integrations/claude";

/**
 * Turns a plain-language workout description into a complete workout —
 * sport, title, category, duration, distance, objective notes, and
 * structured steps — the "Generate with AI" box at the top of
 * WorkoutDialog.tsx, per explicit instruction that the AI should fill
 * the whole dialog, not just the structured steps. Any signed-in
 * athlete can call this (not scoped to "my own workouts" — same
 * "shared coach log" openness every other workout write already has).
 */
export async function POST(req: NextRequest) {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Describe the workout first." }, { status: 400 });
  }

  try {
    const workout = await generateWorkoutFromPrompt(prompt.trim());
    return NextResponse.json(workout);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not generate the workout." }, { status: 500 });
  }
}
