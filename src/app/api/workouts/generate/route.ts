import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { generateWorkoutFromPrompt } from "@/lib/integrations/claude";
import { getAiInstructions, getAiUsageStatus, logAiUsage } from "@/lib/aiAccess";

/**
 * Turns a plain-language workout description into a complete workout —
 * sport, title, category, duration, distance, objective notes, and
 * structured steps — the "Generate with AI" box at the top of
 * WorkoutDialog.tsx, per explicit instruction that the AI should fill
 * the whole dialog, not just the structured steps. Any signed-in
 * athlete can call this for ANY workout (not scoped to "my own
 * workouts" — same "shared coach log" openness every other workout
 * write already has) — but gated on the CALLER's own AI permission and
 * weekly limit, not the workout's assigned athlete (see CLAUDE.md's "AI
 * access control" section: this is about who's using the AI feature,
 * not whose workout it's for).
 */
export async function POST(req: NextRequest) {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const usage = await getAiUsageStatus(me);
  if (!usage.enabled) {
    return NextResponse.json({ error: "AI generation isn't enabled for your account yet — ask an admin." }, { status: 403 });
  }
  if (usage.remaining <= 0) {
    return NextResponse.json({ error: `You've used all ${usage.weeklyLimit} AI generations for this week.` }, { status: 429 });
  }

  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Describe the workout first." }, { status: 400 });
  }

  // Logged right before the real Claude call, once permission/limit
  // checks have already passed — so a prompt that fails downstream
  // (a bad response shape, Claude briefly down) still counts against
  // the quota rather than giving free retries.
  await logAiUsage(me.id);

  try {
    const instructions = await getAiInstructions();
    const workout = await generateWorkoutFromPrompt(prompt.trim(), instructions);
    return NextResponse.json(workout);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not generate the workout." }, { status: 500 });
  }
}
