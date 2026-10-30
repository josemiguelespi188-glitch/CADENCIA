import { useLocale } from "@/lib/i18n/context";
import { Card, CardTitle } from "@/components/ui/card";
import type { Athlete, StravaTotals as Totals } from "@/lib/types";

const ROWS: { key: "run" | "ride" | "swim"; label: string }[] = [
  { key: "run", label: "Run" },
  { key: "ride", label: "Ride" },
  { key: "swim", label: "Swim" },
];

function cell(t: Totals | undefined) {
  if (!t || !t.count) return "—";
  const km = (t.distance / 1000).toFixed(0);
  const hrs = Math.round(t.moving_time / 3600);
  return `${km} km · ${hrs} h`;
}

/**
 * Strava's own aggregate totals (GET /athletes/{id}/stats) — recent 4
 * weeks / year-to-date / all-time, per sport. Real Strava data, not
 * computed by Cadencia. See CLAUDE.md's "What else Strava gives us" note.
 */
export function StravaTotals({ athlete }: { athlete: Athlete }) {
  const { t } = useLocale();
  if (!athlete.strava_stats) return null;
  const s = athlete.strava_stats;

  return (
    <Card>
      <CardTitle>
        {t("strava_totals_h")}
        {athlete.strava_weight_kg ? <span className="ml-2 text-xs font-normal text-ink-3">{t("weight")}: {athlete.strava_weight_kg} kg</span> : null}
      </CardTitle>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-ink-3">
            <th className="py-1.5 font-semibold"> </th>
            <th className="py-1.5 font-semibold">{t("totals_recent")}</th>
            <th className="py-1.5 font-semibold">{t("totals_ytd")}</th>
            <th className="py-1.5 font-semibold">{t("totals_all")}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-1.5 font-medium">{r.label}</td>
              <td className="py-1.5 tabular-nums text-ink-2">{cell(s[`recent_${r.key}_totals`])}</td>
              <td className="py-1.5 tabular-nums text-ink-2">{cell(s[`ytd_${r.key}_totals`])}</td>
              <td className="py-1.5 tabular-nums text-ink-2">{cell(s[`all_${r.key}_totals`])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
