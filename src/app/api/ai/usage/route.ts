import { NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { getAiUsageStatus } from "@/lib/aiAccess";

/**
 * Drives the "Generate with AI" box's own gating UI in WorkoutDialog.tsx —
 * whether this signed-in athlete has AI access at all, and how many of
 * their weekly prompts are left. The real enforcement is server-side in
 * `/api/workouts/generate` regardless of what this returns; this is purely
 * so the UI can show a clear state instead of letting the athlete submit
 * and then fail.
 */
export async function GET() {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const status = await getAiUsageStatus(me);
  return NextResponse.json(status);
}
