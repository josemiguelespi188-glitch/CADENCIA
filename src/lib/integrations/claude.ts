import type { StravaActivity, Workout, WorkoutStep, WorkoutStepDurationType, WorkoutStepKind, WorkoutStepTargetType } from "@/lib/types";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

const STEP_KINDS: WorkoutStepKind[] = ["warmup", "work", "recovery", "cooldown", "rest"];
const DURATION_TYPES: WorkoutStepDurationType[] = ["time", "distance", "open"];
const TARGET_TYPES: WorkoutStepTargetType[] = ["pace", "hr", "power", "cadence", "open"];

/**
 * Drafts a short Strava activity description from the synced activity's
 * own data, plus the matched planned workout's notes (its stated
 * objective) when there is one. Best-effort: returns null (never throws)
 * if ANTHROPIC_API_KEY isn't set or the call fails, matching this
 * codebase's existing "optional AI/notification step never blocks the
 * real work" pattern (see CLAUDE.md's Strava integration notes).
 */
export async function generateActivityDescription(
  activity: Pick<StravaActivity, "name" | "sport_type" | "moving_time_s" | "distance_m" | "average_cadence" | "average_speed">,
  matchedWorkout: Pick<Workout, "title" | "notes"> | null
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const facts = [
    `Activity: ${activity.name} (${activity.sport_type})`,
    `Duration: ${Math.round(activity.moving_time_s / 60)} min`,
    activity.distance_m ? `Distance: ${(activity.distance_m / 1000).toFixed(2)} km` : null,
    activity.average_cadence ? `Average cadence: ${Math.round(activity.average_cadence)}` : null,
    activity.average_speed ? `Average speed: ${activity.average_speed.toFixed(2)} m/s` : null,
    matchedWorkout ? `Planned workout: "${matchedWorkout.title}", objective: ${matchedWorkout.notes || "(no notes)"}` : null,
  ].filter(Boolean);

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system:
          "You write short Strava activity descriptions for an athlete's training log. Plain text, no hashtags, no emoji, 1-3 sentences. Describe what the workout was and, if a planned workout's objective is given, briefly note whether the activity matches it. Never invent data not given to you.",
        messages: [{ role: "user", content: facts.join("\n") }],
      }),
    });
    if (!res.ok) {
      console.error("Claude description generation failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text as string | undefined;
    return text?.trim() || null;
  } catch (e) {
    console.error("Claude description generation failed", e);
    return null;
  }
}

const WORKOUT_STEPS_TOOL = {
  name: "set_workout_steps",
  description: "Returns the structured workout steps parsed from the athlete's plain-language description.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      steps: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            kind: { type: "string" as const, enum: STEP_KINDS },
            durationType: { type: "string" as const, enum: DURATION_TYPES },
            durationValue: {
              type: "number" as const,
              description: "Seconds if durationType is time, meters if distance. 0 if durationType is open.",
            },
            targetType: { type: "string" as const, enum: TARGET_TYPES },
            targetLow: {
              type: "number" as const,
              description:
                "0 if no numeric target was given. Unit depends on targetType: seconds per kilometer for pace, beats per minute for hr, watts for power, revolutions per minute for cadence.",
            },
            targetHigh: {
              type: "number" as const,
              description: "Same unit as targetLow. Equal to targetLow when the athlete gave a single value, not a range. 0 if no numeric target was given.",
            },
            repeatCount: {
              type: "number" as const,
              description: "How many times this one step repeats, e.g. 6 for \"6x400m\". 1 if it doesn't repeat.",
            },
          },
          required: ["kind", "durationType", "durationValue", "targetType", "targetLow", "targetHigh", "repeatCount"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
};

/**
 * Parses an athlete's plain-language workout description (e.g. "10min
 * warmup, 6x400m at 5K pace with 90s jog recovery, 10min cooldown") into
 * Cadencia's own WorkoutStep[] shape, via a forced-shape tool call —
 * `tool_choice: {type: "any"/"tool"}` is rejected on claude-sonnet-5-5
 * (see the claude-api skill's model notes), so this uses `strict: true`
 * on the tool plus `tool_choice: "auto"` with an explicit system
 * instruction to always call it, which still guarantees
 * schema-validated JSON back when the model does call it.
 *
 * Unlike generateActivityDescription() (a best-effort background step
 * that silently skips on failure), this is a direct, interactive user
 * action — it throws on failure so the caller (the API route) can
 * surface a real error to the "Generate" button in WorkoutDialog.tsx,
 * instead of failing silently.
 *
 * Returned steps have no `id` — the caller (WorkoutDialog.tsx) assigns
 * a fresh client-side id to each, same as a manually-added step.
 */
export async function generateWorkoutStepsFromPrompt(prompt: string): Promise<Omit<WorkoutStep, "id">[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI generation is not configured (no ANTHROPIC_API_KEY).");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system:
        "You convert an athlete's plain-language description of a workout into structured steps by calling set_workout_steps exactly once, and never reply with plain text. " +
        "Convert any mm:ss pace the athlete gives (e.g. \"4:30/km\") into total seconds per kilometer for a pace target. " +
        "If the athlete gives a single number for a target, set targetLow and targetHigh equal. " +
        "If the athlete names an intensity with no number anywhere to derive it from (e.g. \"5K pace\", \"easy\", \"hard\", \"threshold\"), set targetType to \"open\" and targetLow/targetHigh to 0 — never invent a number you weren't given. " +
        "repeatCount is how many times ONE step repeats (6 for \"6x400m\"), not a count of separate steps — keep the repeated step as a single entry with repeatCount set, don't list it 6 times.",
      tools: [WORKOUT_STEPS_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const toolUse = (data.content ?? []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "set_workout_steps");
  if (!toolUse) throw new Error("Claude didn't return structured steps — try describing the workout more specifically.");

  const rawSteps = toolUse.input?.steps;
  if (!Array.isArray(rawSteps)) throw new Error("Claude's response wasn't in the expected shape.");

  return rawSteps.map(
    (s: {
      kind?: string;
      durationType?: string;
      durationValue?: number;
      targetType?: string;
      targetLow?: number;
      targetHigh?: number;
      repeatCount?: number;
    }): Omit<WorkoutStep, "id"> => ({
      kind: STEP_KINDS.includes(s.kind as WorkoutStepKind) ? (s.kind as WorkoutStepKind) : "work",
      durationType: DURATION_TYPES.includes(s.durationType as WorkoutStepDurationType) ? (s.durationType as WorkoutStepDurationType) : "open",
      durationValue: typeof s.durationValue === "number" && s.durationValue > 0 ? s.durationValue : null,
      targetType: TARGET_TYPES.includes(s.targetType as WorkoutStepTargetType) ? (s.targetType as WorkoutStepTargetType) : "open",
      targetLow: typeof s.targetLow === "number" && s.targetLow > 0 ? s.targetLow : null,
      targetHigh: typeof s.targetHigh === "number" && s.targetHigh > 0 ? s.targetHigh : null,
      repeatCount: typeof s.repeatCount === "number" && s.repeatCount > 1 ? s.repeatCount : null,
    })
  );
}
