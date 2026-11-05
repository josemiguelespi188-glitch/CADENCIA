import type { ActivityWithSlug } from "@/lib/types";
import { mapStravaSportType } from "@/lib/sport";

export interface CommunitySportTotal {
  sport: string; // Cadencia sport key, or "other" for anything mapStravaSportType can't place
  count: number;
  distanceM: number;
  movingTimeS: number;
}

export interface CommunityMemberTotal {
  athleteId: string;
  count: number;
  distanceM: number;
  movingTimeS: number;
}

export interface CommunityStats {
  totalCount: number;
  totalDistanceM: number;
  totalMovingTimeS: number;
  bySport: CommunitySportTotal[]; // sorted desc by distance
  leaderboard: CommunityMemberTotal[]; // sorted desc by distance
}

/**
 * Aggregates synced Strava activity across every member of a community —
 * Community Phase 2 (see CLAUDE.md's "Community" section). Pure function,
 * no fetch: the caller passes whatever `strava_activities` rows it already
 * loaded. Real Strava data, nothing fabricated — a community with nobody
 * synced simply returns all-zero totals and an empty leaderboard, not a
 * guessed number.
 *
 * `dateRange` (Nov 2026, see CLAUDE.md's "Community event countdown"
 * section — direct request: "Aquí no es un last 30 days. sino desde que
 * comienza el entrenamiento hasta que se llega al día del evento
 * deportivo") narrows the window to a community's own training block
 * instead of whatever `strava_activities` happens to hold — `from`/`to`
 * are inclusive YYYY-MM-DD strings, either side optional (omit `to` to
 * mean "through today," omit `from` for "no lower bound"). Filters on
 * each activity's own local calendar date (`local_date`, falling back to
 * `start_date`'s own date slice for an older row synced before that
 * column existed) — never on `synced_at`, which is unrelated to when the
 * activity itself happened. Omit `dateRange` entirely to keep the old
 * "whatever was passed in" behavior (the caller's own window, e.g. a
 * fixed last-30-days fetch).
 */
export function computeCommunityStats(
  activities: ActivityWithSlug[],
  memberAthleteIds: Set<string>,
  dateRange?: { from?: string | null; to?: string | null },
): CommunityStats {
  const relevant = activities.filter((a) => {
    if (!memberAthleteIds.has(a.athlete_id)) return false;
    if (dateRange) {
      const date = a.local_date ?? a.start_date.slice(0, 10);
      if (dateRange.from && date < dateRange.from) return false;
      if (dateRange.to && date > dateRange.to) return false;
    }
    return true;
  });
  const bySportMap = new Map<string, CommunitySportTotal>();
  const byMemberMap = new Map<string, CommunityMemberTotal>();

  for (const a of relevant) {
    const sKey = mapStravaSportType(a.sport_type) ?? "other";
    const s = bySportMap.get(sKey) ?? { sport: sKey, count: 0, distanceM: 0, movingTimeS: 0 };
    s.count += 1;
    s.distanceM += a.distance_m ?? 0;
    s.movingTimeS += a.moving_time_s ?? 0;
    bySportMap.set(sKey, s);

    const m = byMemberMap.get(a.athlete_id) ?? { athleteId: a.athlete_id, count: 0, distanceM: 0, movingTimeS: 0 };
    m.count += 1;
    m.distanceM += a.distance_m ?? 0;
    m.movingTimeS += a.moving_time_s ?? 0;
    byMemberMap.set(a.athlete_id, m);
  }

  return {
    totalCount: relevant.length,
    totalDistanceM: relevant.reduce((acc, a) => acc + (a.distance_m ?? 0), 0),
    totalMovingTimeS: relevant.reduce((acc, a) => acc + (a.moving_time_s ?? 0), 0),
    bySport: Array.from(bySportMap.values()).sort((a, b) => b.distanceM - a.distanceM),
    leaderboard: Array.from(byMemberMap.values()).sort((a, b) => b.distanceM - a.distanceM),
  };
}
