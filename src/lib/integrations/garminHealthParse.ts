import { createServiceClient } from "@/lib/supabase/server";

/**
 * Decodes raw Garmin Health/Activity push payloads (stored verbatim in
 * garmin_push_events by app/api/webhooks/garmin/[type]/route.ts) into
 * the structured tables migration 029 creates, so the dashboard has
 * real rows to read instead of only an unparsed jsonb blob.
 *
 * **Honesty check on confidence level, read before changing field
 * names**: the OBJECT names this push system uses (ClientSleep,
 * ClientHRVSummary, ClientDaily, ClientDailySpo2Acclimation, etc.) are
 * confirmed from the real OpenAPI spec pasted into this session (see
 * CLAUDE.md's "Garmin Health metrics" note). The individual FIELD
 * names inside each object below are reconstructed from Garmin's
 * well-documented public Health API conventions (durationInSeconds,
 * bodyBatteryChargedValue, timeOffsetSpo2Values, etc. — the same
 * naming pattern CLAUDE.md's own "dailies" field list already uses),
 * not copied verbatim from that spec text in this pass — this file's
 * context window didn't retain the literal field list. So every
 * decoder below is deliberately defensive: it tries several plausible
 * key names/paths per field via `pick()` and falls back to `null`
 * rather than throwing or guessing a value. **Two things must happen
 * before trusting this blindly**: (1) a real push actually lands in
 * garmin_push_events, and (2) its raw payload is diffed against the
 * `pick()` paths below and any that don't match are corrected — the
 * raw jsonb column on every table here exists specifically so that
 * diff is always possible later, same "capture now, parse per type
 * once a real payload is seen" discipline this codebase already
 * applies to every other unconfirmed Garmin shape.
 *
 * Per Section 15.11 of the Garmin Developer Program Agreement, nothing
 * decoded here may ever be used as input to an AI model/system — see
 * lib/integrations/garminDeveloper.ts's file header.
 */

type Json = Record<string, unknown>;

/** Reads the first defined, non-null value found at any of several
 * dot-paths (handles both a flat field and a plausible nested variant,
 * e.g. "sleepScores.overall.value" vs a flat "overallSleepScore"). */
function pick(obj: Json, paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (cur === null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Json)[key];
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return null;
}

function pickNumber(obj: Json, paths: string[]): number | null {
  const v = pick(obj, paths);
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickString(obj: Json, paths: string[]): string | null {
  const v = pick(obj, paths);
  return typeof v === "string" ? v : null;
}

function calendarDateOf(r: Json): string | null {
  return (
    pickString(r, ["calendarDate", "summaryDate", "date"]) ??
    // Some push objects only carry a start-of-day epoch in seconds.
    // Found live (Nov 2026, full codebase audit): `epoch ? ... : null`
    // treated a legitimate epoch of 0 (1970-01-01) as "no value" — an
    // explicit null check is correct since pickNumber already returns
    // null for a genuinely missing field.
    (() => {
      const epoch = pickNumber(r, ["startTimeInSeconds", "calendarDateEpoch"]);
      return epoch !== null ? new Date(epoch * 1000).toISOString().slice(0, 10) : null;
    })()
  );
}

function garminUserIdOf(r: Json): string | null {
  return pickString(r, ["userId", "garminUserId", "userAccessToken"]);
}

/** Resolves a Garmin user id to a Cadencia athlete id, memoized per
 * `processGarminPushEvent()` call via `cache` — found live (Nov 2026,
 * full codebase audit) that every decode* function previously did this
 * DB round trip once PER RECORD even though every record in one push
 * almost always shares the same Garmin user id. */
type AthleteIdCache = Map<string, string | null>;

/**
 * The push envelope itself is unconfirmed (array of records? wrapped
 * under a pluralized key? a single record?) — handle all three rather
 * than assuming one. Returns an empty array for anything unrecognized,
 * never throws.
 */
function extractRecords(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter((r): r is Json => typeof r === "object" && r !== null);
  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload as Json)) {
      if (Array.isArray(value)) return value.filter((r): r is Json => typeof r === "object" && r !== null);
    }
    return [payload as Json];
  }
  return [];
}

async function resolveAthleteId(garminUserId: string | null, cache: AthleteIdCache): Promise<string | null> {
  if (!garminUserId) return null;
  if (cache.has(garminUserId)) return cache.get(garminUserId) ?? null;
  const db = createServiceClient();
  const { data } = await db
    .from("garmin_dev_connections")
    .select("athlete_id")
    .eq("garmin_user_id", garminUserId)
    .maybeSingle();
  const athleteId = data?.athlete_id ?? null;
  cache.set(garminUserId, athleteId);
  return athleteId;
}

type Decoded = Record<string, unknown> & { athlete_id: string; calendar_date?: string; raw: Json };

async function decodeDailyHealth(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      steps: pickNumber(r, ["steps", "totalSteps"]),
      active_kilocalories: pickNumber(r, ["activeKilocalories"]),
      body_battery_charged: pickNumber(r, ["bodyBatteryChargedValue", "bodyBattery.charged"]),
      body_battery_drained: pickNumber(r, ["bodyBatteryDrainedValue", "bodyBattery.drained"]),
      average_stress_level: pickNumber(r, ["averageStressLevel"]),
      max_stress_level: pickNumber(r, ["maxStressLevel"]),
      resting_heart_rate: pickNumber(r, ["restingHeartRateInBeatsPerMinute", "restingHeartRate"]),
      average_heart_rate: pickNumber(r, ["averageHeartRateInBeatsPerMinute", "averageHeartRate"]),
      max_heart_rate: pickNumber(r, ["maxHeartRateInBeatsPerMinute", "maxHeartRate"]),
      raw: r,
    });
  }
  return out;
}

async function decodeSleep(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      duration_s: pickNumber(r, ["durationInSeconds", "sleepTimeSeconds"]),
      deep_s: pickNumber(r, ["deepSleepDurationInSeconds"]),
      light_s: pickNumber(r, ["lightSleepDurationInSeconds"]),
      rem_s: pickNumber(r, ["remSleepInSeconds", "remSleepDurationInSeconds"]),
      awake_s: pickNumber(r, ["awakeDurationInSeconds"]),
      overall_score: pickNumber(r, ["overallSleepScore", "sleepScores.overall.value"]),
      raw: r,
    });
  }
  return out;
}

async function decodeHrv(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      last_night_avg: pickNumber(r, ["lastNightAvg", "hrvSummary.lastNightAvg"]),
      last_night_5min_high: pickNumber(r, ["lastNight5MinHigh", "hrvSummary.lastNight5MinHigh"]),
      raw: r,
    });
  }
  return out;
}

/** Averages the values of an epoch-offset -> reading map, e.g.
 * `{"0": 97, "60": 96}` — the shape Garmin's intraday SpO2/respiration
 * pushes are documented to use. */
function averageOfEpochMap(v: unknown): number | null {
  if (!v || typeof v !== "object") return null;
  const values = Object.values(v as Json).filter((x): x is number => typeof x === "number");
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function decodePulseOx(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    const epochMap = pick(r, ["timeOffsetSpo2Values"]);
    const fromEpoch = averageOfEpochMap(epochMap);
    const values = epochMap && typeof epochMap === "object" ? Object.values(epochMap as Json).filter((x): x is number => typeof x === "number") : [];
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      avg_spo2: pickNumber(r, ["averageSpO2", "averageSpo2"]) ?? fromEpoch,
      min_spo2: pickNumber(r, ["lowestSpO2", "lowestSpo2"]) ?? (values.length ? Math.min(...values) : null),
      raw: r,
    });
  }
  return out;
}

async function decodeRespiration(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    const fromEpoch = averageOfEpochMap(pick(r, ["timeOffsetEpochToBreaths"]));
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      avg_breaths_per_min: pickNumber(r, ["avgWakingRespirationValue", "avgSleepRespirationValue"]) ?? fromEpoch,
      raw: r,
    });
  }
  return out;
}

/** Garmin's Body Composition push is documented to report mass fields
 * in grams, not kg — converted here; a `*Kg` variant is also checked
 * defensively in case the real payload differs. */
async function decodeBodyComp(records: Json[], cache: AthleteIdCache): Promise<(Decoded & { measured_at: string })[]> {
  const out: (Decoded & { measured_at: string })[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    if (!athleteId) continue;
    const epoch = pickNumber(r, ["measurementTimeInSeconds", "startTimeInSeconds"]);
    // Explicit null check, not truthy — a real epoch of 0 (1970-01-01)
    // would otherwise be treated as "no timestamp" and fall back to "now".
    const measuredAt = epoch !== null ? new Date(epoch * 1000).toISOString() : new Date().toISOString();
    const weightG = pickNumber(r, ["weightInGrams"]);
    const muscleG = pickNumber(r, ["muscleMassInGrams"]);
    const boneG = pickNumber(r, ["boneMassInGrams"]);
    out.push({
      athlete_id: athleteId,
      measured_at: measuredAt,
      weight_kg: pickNumber(r, ["weightInKilograms", "weightKg"]) ?? (weightG !== null ? weightG / 1000 : null),
      body_fat_pct: pickNumber(r, ["bodyFatInPercent", "bodyFatPercentage"]),
      body_water_pct: pickNumber(r, ["bodyWaterInPercent", "bodyWaterPercentage"]),
      muscle_mass_kg: pickNumber(r, ["muscleMassInKilograms"]) ?? (muscleG !== null ? muscleG / 1000 : null),
      bone_mass_kg: pickNumber(r, ["boneMassInKilograms"]) ?? (boneG !== null ? boneG / 1000 : null),
      bmi: pickNumber(r, ["bodyMassIndex", "bmi"]),
      raw: r,
    } as Decoded & { measured_at: string });
  }
  return out;
}

async function decodeHydration(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r);
    if (!athleteId || !calendarDate) continue;
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      fluid_intake_ml: pickNumber(r, ["valueInMilliliters", "hydrationValueInML", "sweatLossInMilliliters"]),
      raw: r,
    });
  }
  return out;
}

async function decodeHealthSnapshot(records: Json[], cache: AthleteIdCache): Promise<Decoded[]> {
  const out: Decoded[] = [];
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    const calendarDate = calendarDateOf(r) ?? new Date().toISOString().slice(0, 10);
    if (!athleteId) continue;
    const summaries = pick(r, ["summaries", "summaryList"]);
    out.push({
      athlete_id: athleteId,
      calendar_date: calendarDate,
      summaries: Array.isArray(summaries) ? summaries : null,
      raw: r,
    });
  }
  return out;
}

/** "user-metrics" push — updates athletes.garmin_vo2max/_cycling/fitness_age
 * directly (latest value only, no history table — see migration 029).
 *
 * Found live (Nov 2026, full codebase audit): this used to write all
 * three fields unconditionally, so a push carrying only one of them
 * (plausible — Garmin may deliver VO2max and Fitness Age as separate
 * pushes at different times) nulled out the other two previously-synced
 * values. Now only includes a field in the update when this push
 * actually carried it. */
async function applyUserMetrics(records: Json[], cache: AthleteIdCache): Promise<void> {
  const db = createServiceClient();
  for (const r of records) {
    const athleteId = await resolveAthleteId(garminUserIdOf(r), cache);
    if (!athleteId) continue;
    const vo2max = pickNumber(r, ["vo2Max", "vo2MaxRunning"]);
    const vo2maxCycling = pickNumber(r, ["vo2MaxCycling"]);
    const fitnessAge = pickNumber(r, ["fitnessAge"]);
    const updates: Record<string, unknown> = { garmin_health_synced_at: new Date().toISOString() };
    if (vo2max !== null) updates.garmin_vo2max = vo2max;
    if (vo2maxCycling !== null) updates.garmin_vo2max_cycling = vo2maxCycling;
    if (fitnessAge !== null) updates.garmin_fitness_age = fitnessAge;
    await db.from("athletes").update(updates).eq("id", athleteId);
  }
}

/**
 * Found live (Nov 2026, full codebase audit): `.upsert(..., {onConflict})`
 * does a full-row replace on conflict — a later same-day push with
 * fewer populated fields than an earlier push for that day silently
 * nulled out columns the earlier push had already filled. Fetches
 * whatever row already exists for each (athlete_id, calendar_date) in
 * this batch and fills any null field in the new row from it, so a
 * sparse push never erases data a fuller earlier push already stored.
 */
async function mergeWithExisting(db: ReturnType<typeof createServiceClient>, table: string, rows: Decoded[]): Promise<Decoded[]> {
  if (!rows.length) return rows;
  const athleteIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const dates = Array.from(new Set(rows.map((r) => r.calendar_date).filter((d): d is string => !!d)));
  const { data: existing } = await db.from(table).select("*").in("athlete_id", athleteIds).in("calendar_date", dates);
  const existingByKey = new Map((existing ?? []).map((e: Json) => [`${e.athlete_id}|${e.calendar_date}`, e]));
  return rows.map((r) => {
    const prev = existingByKey.get(`${r.athlete_id}|${r.calendar_date}`);
    if (!prev) return r;
    const merged: Decoded = { ...r };
    for (const key of Object.keys(r)) {
      if (key === "athlete_id" || key === "calendar_date" || key === "raw" || key === "synced_at") continue;
      if (merged[key] === null && prev[key] !== null && prev[key] !== undefined) merged[key] = prev[key];
    }
    return merged;
  });
}

/** Endpoint-type slug aliases -> handler. Matched case-insensitively
 * against the `[type]` path segment the push actually hit, so this
 * codebase's own guessed URL naming (see the webhook route's own
 * header) doesn't have to match Garmin's internal names exactly. */
const HANDLERS: { match: string[]; table: string | null; decode: (records: Json[], cache: AthleteIdCache) => Promise<Decoded[]> }[] = [
  { match: ["dailies", "daily", "daily-health"], table: "garmin_daily_health", decode: decodeDailyHealth },
  { match: ["sleeps", "sleep"], table: "garmin_sleep", decode: decodeSleep },
  { match: ["hrv-summary", "hrv-summaries", "hrv"], table: "garmin_hrv", decode: decodeHrv },
  { match: ["pulse-ox", "pulseox", "pulse-oxes"], table: "garmin_pulse_ox", decode: decodePulseOx },
  { match: ["respiration", "respirations"], table: "garmin_respiration", decode: decodeRespiration },
  { match: ["hydration", "hydrations"], table: "garmin_hydration", decode: decodeHydration },
  { match: ["health-snapshot", "health-snapshots"], table: "garmin_health_snapshot", decode: decodeHealthSnapshot },
];

/**
 * Parses and upserts one garmin_push_events row's payload into the
 * right structured table (or updates athletes, for user-metrics),
 * based on the `endpoint_type` the webhook route already resolved from
 * the URL it was hit on. Best-effort: never throws — a parse failure
 * is logged and left for manual inspection via the row's own raw
 * jsonb, it must never turn into a failed webhook ack (Garmin would
 * retry/back off an endpoint that errors).
 */
export async function processGarminPushEvent(endpointType: string, payload: unknown): Promise<void> {
  try {
    const slug = endpointType.toLowerCase();
    const records = extractRecords(payload);
    if (!records.length) return;
    // One athlete-id cache per push — see resolveAthleteId()'s own comment.
    const cache: AthleteIdCache = new Map();

    if (["body-compositions", "body-composition", "body-comp"].includes(slug)) {
      const decoded = await decodeBodyComp(records, cache);
      if (!decoded.length) return;
      const db = createServiceClient();
      const { error } = await db.from("garmin_body_comp").insert(decoded);
      if (error) console.error("Failed to insert garmin_body_comp rows", error);
      return;
    }

    if (["user-metrics", "user-metric"].includes(slug)) {
      await applyUserMetrics(records, cache);
      return;
    }

    const handler = HANDLERS.find((h) => h.match.includes(slug));
    if (!handler || !handler.table) return;

    const decoded = await handler.decode(records, cache);
    if (!decoded.length) return;

    const db = createServiceClient();
    const merged = await mergeWithExisting(db, handler.table, decoded);
    const { error } = await db.from(handler.table).upsert(merged, { onConflict: "athlete_id,calendar_date" });
    if (error) console.error(`Failed to upsert ${handler.table} rows`, error);
  } catch (e) {
    console.error(`processGarminPushEvent threw for endpoint_type=${endpointType}`, e);
  }
}
