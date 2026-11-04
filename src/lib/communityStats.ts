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
 * no fetch: the caller passes whatever window `strava_activities` already
 * covers (last 30 days, same as everywhere else in this app that reads
 * this table — see CLAUDE.md's "no necesito lo histórico" note on Strava
 * sync). Real Strava data, nothing fabricated — a community with nobody
 * synced simply returns all-zero totals and an empty leaderboard, not a
 * guessed number.
 */
export function computeCommunityStats(activities: ActivityWithSlug[], memberAthleteIds: Set<string>): CommunityStats {
  const relevant = activities.filter((a) => memberAthleteIds.has(a.athlete_id));
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
