"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ATHLETES, type Athlete } from "@/lib/types";

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
  const router = useRouter();
  const searchParams = useSearchParams();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/strava/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push("/auth");
        return;
      }
      const { data: a } = await supabase.from("athletes").select("*").eq("auth_user_id", data.user.id).maybeSingle();
      setAthlete((a as Athlete) ?? null);
      setCheckingAuth(false);
      loadStatus();
    })();
  }, [router, loadStatus]);

  useEffect(() => {
    const strava = searchParams.get("strava");
    // Deriving a one-time toast from the ?strava= redirect query param —
    // not render-derived state, so this has to live in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (strava === "connected") setToast(isEn ? "Strava connected." : "Strava conectado.");
    else if (strava === "error") setToast(isEn ? "Could not connect Strava. Try again." : "No se pudo conectar Strava. Intenta de nuevo.");
  }, [searchParams, isEn]);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      setToast(res.ok ? (isEn ? `Synced ${data.synced} activities.` : `Se sincronizaron ${data.synced} actividades.`) : data.error);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/strava/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  if (checkingAuth) return null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("settings_h")}</h1>

          {toast && (
            <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">{toast}</div>
          )}

          <Card>
            <CardTitle>Strava</CardTitle>
            <p className="mt-2 text-sm text-ink-2">
              {athlete
                ? isEn
                  ? `Connected as ${ATHLETES[athlete.slug].name}.`
                  : `Conectado como ${ATHLETES[athlete.slug].name}.`
                : ""}
            </p>

            <div className="mt-4 flex items-center gap-3">
              <span
                className={
                  "h-2.5 w-2.5 rounded-full " + (status?.connected ? "bg-[var(--run)]" : "bg-ink-3")
                }
                style={status?.connected ? { background: "#2E8B57" } : undefined}
              />
              <span className="text-sm">
                {status?.connected ? t("strava_connected") : (isEn ? "Not connected" : "No conectado")}
              </span>
            </div>

            {status?.connected && (
              <p className="mt-1 text-xs text-ink-3">
                {t("strava_last_sync")}: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString(locale) : t("strava_never")}
              </p>
            )}

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
                <a href="/api/strava/connect">
                  <Button size="sm">{t("strava_connect")}</Button>
                </a>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
