import type { StravaActivity, Workout } from "@/lib/types";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

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
