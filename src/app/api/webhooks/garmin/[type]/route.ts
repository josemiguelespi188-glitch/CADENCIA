import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Garmin Connect Developer Program (Starter Access) delivers data by
 * PUSH ONLY — there is no pull/poll endpoint at this tier. **Confirmed
 * live** (Nov 2026, via the real "API Tools -> Endpoint Configuration"
 * page at apis.garmin.com/tools/endpoints): Garmin does NOT use one
 * generic webhook — it registers a SEPARATE URL per data type, each
 * with its own "on hold"/"enabled" checkboxes. Rows seen there include
 * (at least): ACTIVITY - Activities, ACTIVITY - Activity Details,
 * ACTIVITY - Activity Files, ACTIVITY - Manually Updated Activities,
 * ACTIVITY - MoveIQ, COMMON - Deregistrations, COMMON - User
 * Permissions Change, plus a HEALTH - * family (not used here, see
 * below) and presumably a TRAINING - * family further down the page
 * that wasn't visible in the screenshot this was built from.
 *
 * `[type]` is a free-form path segment — register one of these URLs
 * per row that matters for this app:
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/activities
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/activity-details
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/activity-files
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/manually-updated-activities
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/moveiq
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/deregistrations
 *   https://cadenciatraining.vercel.app/api/webhooks/garmin/permissions-change
 * (and a training-* one once that row is found — see CLAUDE.md). Using
 * a distinct URL per type, rather than one shared URL, means a push's
 * type is always known for certain from the URL it hit — never guessed
 * from the body, since the body shape itself is still unconfirmed.
 *
 * **Deliberately NOT registering any HEALTH - * row** — per the scope
 * actually requested on the app ("Activity API" + "Training API"
 * only), matching the project's standing "never request more access
 * than a built feature needs" discipline.
 *
 * **COMMON - Deregistrations matters for real compliance, not just
 * data sync**: when an athlete revokes access from Garmin's own side
 * (not via our Disconnect button), this is how we'd find out — the
 * stored `garmin_dev_connections` row should be deleted in response
 * once this event's real payload shape is confirmed and a handler for
 * it is built. Not yet built — today every push, from every type, is
 * just stored raw and nothing more. See the next entry on this file's
 * history for when that follow-up lands.
 *
 * Per Section 15.11 of the Garmin Developer Program Agreement, nothing
 * stored here may ever be used as input to an AI model/system — see
 * lib/integrations/garminDeveloper.ts's file header.
 *
 * No signature verification is implemented — Garmin's push-signing
 * scheme (if any) wasn't found/confirmed from this sandbox. Acks fast
 * (200) regardless of payload shape, since a push service generally
 * expects a quick ack and otherwise retries/backs off.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db.from("garmin_push_events").insert({ endpoint_type: type, payload });
  if (error) {
    console.error(`Failed to store Garmin push event (${type})`, error);
    // Still ack — losing one event to a transient DB hiccup is better
    // than Garmin's retry/backoff treating this endpoint as broken.
  }

  return NextResponse.json({ ok: true });
}

/** Some push services send a GET first to verify the endpoint is alive
 * before registering it — unconfirmed whether Garmin does this, but
 * answering it costs nothing. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
