import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { generateWorkoutStepsFromPrompt } from "@/lib/integrations/claude";

/**
 * Turns a plain-language workout description into structured steps —
 * the "Generate with AI" button in WorkoutDialog.tsx's structured-steps
 * editor, so filling it out isn't always manual row-by-row entry. Any
 * signed-in athlete can call this (not scoped to "my own workouts" —
 * same "shared coach log" openness every other workout write already
 * has in this codebase).
 */
export async function POST(req: NextRequest) {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Describe the workout first." }, { status: 400 });
  }

  try {
    const steps = await generateWorkoutStepsFromPrompt(prompt.trim());
    return NextResponse.json({ steps });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not generate steps." }, { status: 500 });
  }
}
