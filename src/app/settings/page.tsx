"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ATHLETES, type Athlete, type AthleteSlug } from "@/lib/types";
import { parsePace } from "@/lib/dates";
import { ZoneTables } from "@/components/ZoneTables";

interface StravaStatus {
  connected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const searchParams = useSearchParams();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const strava = searchParams.get("strava");
    // Deriving a one-time toast from the ?strava= redirect query param —
    // not render-derived state, so this has to live in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (strava === "connected") setToast(isEn ? "Strava connected." : "Strava conectado.");
    else if (strava === "error") setToast(isEn ? "Could not connect Strava. Try again." : "No se pudo conectar Strava. Intenta de nuevo.");
  }, [searchParams, isEn]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("settings_h")}</h1>

          {toast && <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">{toast}</div>}

          <div className="flex flex-col gap-4">
            {(Object.keys(ATHLETES) as AthleteSlug[]).map((slug) => (
              <AthleteZonesCard key={slug} slug={slug} />
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-4">
            {(Object.keys(ATHLETES) as AthleteSlug[]).map((slug) => (
              <AthleteStravaCard key={slug} slug={slug} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function AthleteStravaCard({ slug }: { slug: AthleteSlug }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/strava/status?athlete=${slug}`);
    if (res.ok) setStatus(await res.json());
  }, [slug]);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/strava/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteSlug: slug }),
      });
      const data = await res.json();
      setMessage(
        res.ok
          ? isEn
            ? `Synced ${data.synced} activities · ${data.matched} auto-completed · ${data.described} descriptions written.`
            : `${data.synced} actividades sincronizadas · ${data.matched} auto-completados · ${data.described} descripciones escritas.`
          : data.error
      );
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/strava/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteSlug: slug }),
      });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>
        {ATHLETES[slug].name} · Strava
      </CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }}
        />
        <span className="text-sm">{status?.connected ? t("strava_connected") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      {status?.connected && (
        <p className="mt-1 text-xs text-ink-3">
          {t("strava_last_sync")}: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString(locale) : t("strava_never")}
        </p>
      )}

      {message && <p className="mt-2 text-xs text-ink-2">{message}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {status?.connected ? (
          <>
            <Button size="sm" onClick={sync} disabled={busy}>
              {t("strava_sync")}
            </Button>
            <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
              {t("strava_disconnect")}
            </Button>
          </>
        ) : (
          <a href={`/api/strava/connect?athlete=${slug}`}>
            <Button size="sm">{t("strava_connect")}</Button>
          </a>
        )}
      </div>
    </Card>
  );
}

function AthleteZonesCard({ slug }: { slug: AthleteSlug }) {
  const { t } = useLocale();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [lthr, setLthr] = useState("");
  const [paceMin, setPaceMin] = useState("");
  const [paceSec, setPaceSec] = useState("");
  const [ftp, setFtp] = useState("");
  const [vo2max, setVo2max] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("athletes").select("*").eq("slug", slug).maybeSingle();
    const a = data as Athlete | null;
    setAthlete(a);
    setLthr(a?.threshold_hr ? String(a.threshold_hr) : "");
    setPaceMin(a?.threshold_pace_sec_per_km ? String(Math.floor(a.threshold_pace_sec_per_km / 60)) : "");
    setPaceSec(a?.threshold_pace_sec_per_km ? String(a.threshold_pace_sec_per_km % 60) : "");
    setFtp(a?.ftp_watts ? String(a.ftp_watts) : "");
    setVo2max(a?.vo2max ? String(a.vo2max) : "");
  }, [slug]);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete) return;
    setSaving(true);
    setSaved(false);
    try {
      const supabase = createClient();
      await supabase
        .from("athletes")
        .update({
          threshold_hr: lthr ? Number(lthr) : null,
          threshold_pace_sec_per_km: parsePace(paceMin || "0", paceSec || "0"),
          ftp_watts: ftp ? Number(ftp) : null,
          vo2max: vo2max ? Number(vo2max) : null,
        })
        .eq("id", athlete.id);
      setSaved(true);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Card>
      <CardTitle>
        {ATHLETES[slug].name} · {t("zones_h")}
      </CardTitle>

      <form onSubmit={save} className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{t("lthr")} (bpm)</label>
          <input
            type="number"
            min={0}
            max={250}
            value={lthr}
            onChange={(e) => setLthr(e.target.value)}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{t("ftp")} (W)</label>
          <input
            type="number"
            min={0}
            max={2000}
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{t("threshold_pace")} (min/km)</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={59}
              placeholder="M"
              value={paceMin}
              onChange={(e) => setPaceMin(e.target.value)}
              className="h-10 w-16 rounded-xl border border-line bg-bg px-3 text-sm"
            />
            <span className="text-ink-3">:</span>
            <input
              type="number"
              min={0}
              max={59}
              placeholder="SS"
              value={paceSec}
              onChange={(e) => setPaceSec(e.target.value)}
              className="h-10 w-16 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-ink-2">{t("vo2max")} (ml/kg/min)</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={vo2max}
            onChange={(e) => setVo2max(e.target.value)}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
          />
        </div>

        <div className="col-span-2 mt-1 flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving || !athlete}>
            {t("save")}
          </Button>
          {saved && <span className="text-xs text-ink-3">{t("zones_saved")}</span>}
        </div>
      </form>
      </Card>
      {athlete && (athlete.threshold_hr || athlete.threshold_pace_sec_per_km || athlete.ftp_watts || athlete.strava_hr_zones) && (
        <div className="mt-4">
          <ZoneTables athlete={athlete} />
        </div>
      )}
    </>
  );
}
