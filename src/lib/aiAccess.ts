import { createServiceClient } from "@/lib/supabase/server";
import type { Athlete } from "@/lib/types";

/**
 * AI access control (Nov 2026) — direct instruction: "lOS USUARIOS TIENEN
 * QUE tener permiso para usar ai. Y sería buenazo poner un limite de
 * prompts que tienen a la semana." See CLAUDE.md's "AI access control"
 * section. Gates two things per athlete: `ai_enabled` (both the
 * interactive "Generate with AI" box and the automatic Strava
 * description write-back) and `ai_weekly_limit` (the interactive
 * "Generate with AI" box only — the automatic write-back is a background
 * system process, not a countable "prompt").
 */

const WINDOW_DAYS = 7;

export interface AiUsageStatus {
  enabled: boolean;
  weeklyLimit: number;
  usedThisWeek: number;
  remaining: number;
}

/** How many "Generate with AI" prompts this athlete has used in the last
 * rolling 7 days (not a calendar-week reset). */
export async function getAiUsageStatus(athlete: Pick<Athlete, "id" | "ai_enabled" | "ai_weekly_limit">): Promise<AiUsageStatus> {
  const db = createServiceClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("athlete_id", athlete.id)
    .gte("created_at", since);
  const used = count ?? 0;
  return {
    enabled: athlete.ai_enabled,
    weeklyLimit: athlete.ai_weekly_limit,
    usedThisWeek: used,
    remaining: Math.max(0, athlete.ai_weekly_limit - used),
  };
}

/** Records one "Generate with AI" attempt against this athlete's weekly
 * quota — call right before making the actual Claude call, once the
 * permission + limit checks have already passed, so a retried/failed
 * generation still counts (prevents gaming the limit via intentional
 * failures). */
export async function logAiUsage(athleteId: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("ai_usage_log").insert({ athlete_id: athleteId });
  if (error) console.error("Failed to log AI usage", error);
}

/** The global admin-editable instructions block appended to every Claude
 * system prompt — empty string if never set. Best-effort: a read failure
 * just means no extra instructions get appended, never blocks generation. */
export async function getAiInstructions(): Promise<string> {
  const db = createServiceClient();
  try {
    const { data } = await db.from("ai_settings").select("instructions").eq("id", true).maybeSingle();
    return data?.instructions ?? "";
  } catch (e) {
    console.error("Failed to load AI instructions", e);
    return "";
  }
}
