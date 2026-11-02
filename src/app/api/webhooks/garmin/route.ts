import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Garmin Connect Developer Program (Starter Access) delivers data by
 * PUSH ONLY — there is no pull/poll endpoint at this tier. Garmin calls
 * this URL whenever an athlete's device syncs (Activity, Health,
 * Women's Health, or Training data, depending on which notification
 * this is). Register this exact URL in the Garmin Developer Portal's
 * "API Tools" -> data delivery settings page:
 * `https://cadenciatraining.vercel.app/api/webhooks/garmin`.
 *
 * **The real payload shape per API family is unconfirmed** from this
 * sandbox (developer.garmin.com is blocked here, same standing
 * limitation as COROS's docs) — rather than guess a shape and silently
 * drop fields that don't match, every delivery is stored verbatim in
 * `garmin_push_events` first. Parsing into real structured rows
 * (matching into `workouts`/a new Garmin activities table, same
 * auto-complete pattern Strava already has) is a follow-up once a real
 * payload has actually been seen and `processed` rows can be decoded
 * with confidence — same "capture now, parse later" discipline this
 * codebase already applies to unconfirmed third-party shapes elsewhere.
 *
 * Per Section 15.11 of the Garmin Developer Program Agreement, nothing
 * stored here may ever be used as input to an AI model/system (not even
 * a single Claude inference call) — see
 * lib/integrations/garminDeveloper.ts's file header.
 *
 * No signature verification is implemented — Garmin's push-signing
 * scheme (if any) wasn't found/confirmed from this sandbox either.
 * Acknowledges fast (200) regardless of payload shape, since a push
 * service generally expects a quick ack and will otherwise retry/back
 * off, same reasoning the ClickUp webhook in the Operations Hub
 * codebase follows.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("garmin_push_events").insert({ payload });
  if (error) {
    console.error("Failed to store Garmin push event", error);
    // Still ack — losing one event to a transient DB hiccup is better
    // than Garmin's retry/backoff treating this endpoint as broken.
  }

  return NextResponse.json({ ok: true });
}

/** Some push services send a GET first to verify the endpoint is alive
 * before registering it (mirrors the "SERVICE STATUS CHECK URL" concept
 * from the COROS application form) — unconfirmed whether Garmin does
 * this, but answering it costs nothing. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
