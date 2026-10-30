import { useLocale } from "@/lib/i18n/context";
import { Card, CardTitle } from "@/components/ui/card";
import type { Athlete } from "@/lib/types";
import { computeHrZones, computePaceZones, computePowerZones, type ZoneKey } from "@/lib/zones";
import { paceLabel } from "@/lib/dates";

const ZONE_ORDER: ZoneKey[] = ["recovery", "endurance", "tempo", "threshold", "vo2max", "anaerobic", "neuromuscular"];

function ZoneRow({ label, range }: { label: string; range: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums font-medium" style={{ fontFamily: "var(--font-mono)" }}>
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

  const hrFromStrava = athlete.strava_hr_zones && athlete.strava_hr_zones.length > 0;
  const hrZones = hrFromStrava
    ? athlete.strava_hr_zones!.map((z, i) => ({ key: ZONE_ORDER[i] ?? "anaerobic", min: z.min, max: z.max === -1 ? null : z.max }))
    : athlete.threshold_hr
      ? computeHrZones(athlete.threshold_hr)
      : null;

  const powerFromStrava = athlete.strava_power_zones && athlete.strava_power_zones.length > 0;
  const powerZones = powerFromStrava
    ? athlete.strava_power_zones!.map((z, i) => ({ key: ZONE_ORDER[i] ?? "neuromuscular", min: z.min, max: z.max === -1 ? null : z.max }))
    : athlete.ftp_watts
      ? computePowerZones(athlete.ftp_watts)
      : null;

  const paceZones = athlete.threshold_pace_sec_per_km ? computePaceZones(athlete.threshold_pace_sec_per_km) : null;

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
        <CardTitle>{t("pace_zones")}</CardTitle>
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
