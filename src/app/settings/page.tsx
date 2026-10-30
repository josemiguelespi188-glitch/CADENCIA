"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ATHLETES, type AthleteSlug } from "@/lib/types";

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
      setMessage(res.ok ? (isEn ? `Synced ${data.synced} activities.` : `Se sincronizaron ${data.synced} actividades.`) : data.error);
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
          style={{ background: status?.connected ? "#2E8B57" : "var(--ink-3)" }}
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
