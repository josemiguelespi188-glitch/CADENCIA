import { NextRequest, NextResponse } from "next/server";
import { getSignedInAthlete } from "@/lib/auth";
import { pushStructuredWorkoutToCorosMcp } from "@/lib/integrations/corosMcp";

/**
 * Pushes one workout's structured steps to COROS. **Not actually
 * implemented yet** — `pushStructuredWorkoutToCorosMcp()` always throws
 * a clear error, since the real COROS MCP `course` payload schema is
 * still unconfirmed. See lib/integrations/corosMcp.ts's file header for
 * the real reason and what's needed before this can work.
 */
export async function POST(req: NextRequest) {
  const me = await getSignedInAthlete();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { workoutId } = await req.json().catch(() => ({}));
  if (!workoutId) return NextResponse.json({ error: "workoutId is required." }, { status: 400 });

  try {
    await pushStructuredWorkoutToCorosMcp();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "COROS push failed." }, { status: 500 });
  }
}
