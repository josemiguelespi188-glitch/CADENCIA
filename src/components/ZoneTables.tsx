import { useLocale } from "@/lib/i18n/context";
import { Card, CardTitle } from "@/components/ui/card";
import type { Athlete } from "@/lib/types";
import { resolveHrZones, resolvePaceZones, resolvePowerZones } from "@/lib/zones";
import { paceLabel } from "@/lib/dates";

function ZoneRow({ label, range }: { label: string; range: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className="shrink-0 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm tabular-nums text-ink-2"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {range}
      </span>
    </div>
  );
}

/**
 * Shows an athlete's heart-rate, pace, and power zones — Strava's own
 * configured zones when available (HR/power only — Strava has no pace
 * zones endpoint), otherwise computed from the manually-entered
 * thresholds (see lib/zones.ts for the standard %-of-threshold model
 * used). Reused by /settings (editable context) and /dashboard (read-only
 * summary) — see CLAUDE.md.
 */
export function ZoneTables({ athlete }: { athlete: Athlete }) {
  const { t } = useLocale();

  const { zones: hrZones, fromStrava: hrFromStrava } = resolveHrZones(athlete);
  const { zones: powerZones, fromStrava: powerFromStrava } = resolvePowerZones(athlete);
  const paceZones = resolvePaceZones(athlete);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardTitle>
          {t("hr_zones")}
          <span className="ml-2 text-xs font-normal text-ink-3">{hrFromStrava ? t("from_strava") : t("computed")}</span>
        </CardTitle>
        <div className="mt-3 divide-y divide-line">
          {hrZones ? (
            hrZones.map((z) => <ZoneRow key={z.key} label={t(`zone_${z.key}`)} range={`${z.min}${z.max ? `–${z.max}` : "+"} bpm`} />)
          ) : (
            <p className="py-2 text-sm text-ink-3">{t("need_threshold")}</p>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>
          {t("pace_zones")}
          {/* Found live (Nov 2026, direct feedback: "se ve feo esto") —
              this card never got the "Computed"/"From Strava" badge the
              HR and Power cards both have, which read as visually
              inconsistent sitting between two cards that do. Pace is
              ALWAYS computed (Strava's zones endpoint has no pace zones
              at all, see this file's own header comment), so this badge
              never needs the fromStrava conditional the other two use. */}
          <span className="ml-2 text-xs font-normal text-ink-3">{t("computed")}</span>
        </CardTitle>
        <div className="mt-3 divide-y divide-line">
          {paceZones ? (
            paceZones.map((z) => (
              <ZoneRow
                key={z.key}
                label={t(`zone_${z.key}`)}
                range={
                  z.fastSecPerKm === null
                    ? `> ${paceLabel(z.slowSecPerKm)}`
                    : z.slowSecPerKm === null
                      ? `< ${paceLabel(z.fastSecPerKm)}`
                      : `${paceLabel(z.fastSecPerKm)}–${paceLabel(z.slowSecPerKm)}`
                }
              />
            ))
          ) : (
            <p className="py-2 text-sm text-ink-3">{t("need_threshold")}</p>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>
          {t("power_zones")}
          <span className="ml-2 text-xs font-normal text-ink-3">{powerFromStrava ? t("from_strava") : t("computed")}</span>
        </CardTitle>
        <div className="mt-3 divide-y divide-line">
          {powerZones ? (
            powerZones.map((z) => <ZoneRow key={z.key} label={t(`zone_${z.key}`)} range={`${z.min}${z.max ? `–${z.max}` : "+"} W`} />)
          ) : (
            <p className="py-2 text-sm text-ink-3">{t("need_threshold")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
