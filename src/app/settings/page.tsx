"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Athlete } from "@/lib/types";
import { parsePace } from "@/lib/dates";
import { AthleteProfileCard } from "@/components/AthleteProfileCard";

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
  const { t, locale, toggle: toggleLocale } = useLocale();
  const isEn = locale === "en";
  const { me, signOut } = useAuth();
  const searchParams = useSearchParams();
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      // Read in an effect, not a lazy initializer — see the same note in
      // lib/i18n/context.tsx (avoids a server/client hydration mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("cadencia-theme") === "dark") setDark(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    try {
      if (next) {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("cadencia-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("cadencia-theme", "light");
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const strava = searchParams.get("strava");
    const coros = searchParams.get("coros");
    const garmindev = searchParams.get("garmindev");
    // Deriving a one-time toast from the ?strava=/?coros=/?garmindev=
    // redirect query params — not render-derived state, so this has to
    // live in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (strava === "connected") setToast(isEn ? "Strava connected." : "Strava conectado.");
    else if (strava === "error") setToast(isEn ? "Could not connect Strava. Try again." : "No se pudo conectar Strava. Intenta de nuevo.");
    else if (coros === "connected") setToast(isEn ? "COROS connected." : "COROS conectado.");
    else if (coros === "error") setToast(isEn ? "Could not connect COROS. Its API may not be configured yet." : "No se pudo conectar COROS. Puede que su API todavía no esté configurada.");
    else if (garmindev === "connected") setToast(isEn ? "Garmin connected." : "Garmin conectado.");
    else if (garmindev === "error")
      setToast(
        isEn
          ? "Could not connect Garmin. Its API may not be configured yet."
          : "No se pudo conectar Garmin. Puede que su API todavía no esté configurada."
      );
  }, [searchParams, isEn]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">{t("settings_h")}</h1>

          {toast && <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">{toast}</div>}

          {!me ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : (
            <>
              <AthleteProfileCard slug={me.slug} />

              <div className="mt-8">
                <AthleteZonesCard slug={me.slug} name={me.name} />
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <AthleteStravaCard name={me.name} />
                <AthleteCorosCard name={me.name} />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <AthleteGarminDevCard name={me.name} />
                <AthleteGarminCard name={me.name} />
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-5 border-t border-line pt-6">
                <button onClick={toggleLocale} className="text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors">
                  {t("other_lang")}
                </button>

                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors"
                >
                  {dark ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="3.5" />
                      <line x1="8" y1="1" x2="8" y2="2.5" />
                      <line x1="8" y1="13.5" x2="8" y2="15" />
                      <line x1="1" y1="8" x2="2.5" y2="8" />
                      <line x1="13.5" y1="8" x2="15" y2="8" />
                      <line x1="3.05" y1="3.05" x2="4.1" y2="4.1" />
                      <line x1="11.9" y1="11.9" x2="12.95" y2="12.95" />
                      <line x1="12.95" y1="3.05" x2="11.9" y2="4.1" />
                      <line x1="4.1" y1="11.9" x2="3.05" y2="12.95" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z" />
                    </svg>
                  )}
                  {dark ? (isEn ? "Light mode" : "Modo claro") : isEn ? "Dark mode" : "Modo oscuro"}
                </button>

                <button onClick={signOut} className="ml-auto text-xs uppercase tracking-wide text-ink-3 hover:text-ink transition-colors">
                  {t("sign_out")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function AthleteStravaCard({ name }: { name: string }) {
  const { t, locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/strava/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
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
      await fetch("/api/strava/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{name} · Strava</CardTitle>

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
          <a href="/api/strava/connect">
            <Button size="sm">{t("strava_connect")}</Button>
          </a>
        )}
      </div>
    </Card>
  );
}

/**
 * Honest placeholder — per explicit instruction that the intro/settings
 * flow should offer connecting both Strava AND COROS/Garmin, with a plain
 * note that the latter isn't built yet (see CLAUDE.md's COROS/Garmin
 * research note: it's real scope of its own, not something to fake a
 * working button for).
 */
/**
 * Real Connect/Disconnect UI now (not the disabled placeholder it used
 * to be) — but COROS's real API endpoints are still unconfirmed (see
 * lib/integrations/coros.ts's file header), so clicking Connect before
 * COROS_CLIENT_ID/COROS_AUTHORIZE_URL/etc. are set on Vercel returns a
 * clear "not configured" error, same maturation path Strava went through
 * before its own env vars were set. No "Sync now" button here — COROS
 * only has a push capability planned (per-workout, from the workout
 * dialog), not a pull/sync like Strava's.
 */
function AthleteCorosCard({ name }: { name: string }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/coros/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/coros/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{name} · COROS</CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }} />
        <span className="text-sm">{status?.connected ? (isEn ? "Connected" : "Conectado") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        {isEn
          ? "COROS's real API is still pending approval. Connecting may not work yet. See CLAUDE.md."
          : "La API real de COROS todavía está pendiente de aprobación. Puede que conectar no funcione todavía. Ver CLAUDE.md."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {status?.connected ? (
          <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
            {isEn ? "Disconnect" : "Desconectar"}
          </Button>
        ) : (
          <a href="/api/coros/connect">
            <Button size="sm">{isEn ? "Connect" : "Conectar"}</Button>
          </a>
        )}
      </div>
    </Card>
  );
}

function AthleteZonesCard({ slug, name }: { slug: string; name: string }) {
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
    <Card>
      <CardTitle>
        {name} · {t("zones_h")}
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
  );
}

/**
 * Garmin's **Personal API** — deliberately NOT an OAuth connect button
 * like Strava/COROS above. This is a long-lived key the athlete
 * generates for THEMSELVES at Garmin Connect's own settings page, per
 * Garmin's own terms ("meant for individual Garmin users... not
 * intended for commercial applications serving multiple end users") —
 * see CLAUDE.md's "Garmin Personal API" section for the full story,
 * including why this app can't use it to push workouts (read-only,
 * pull-only) the way the COROS Partner API is meant to. Saving the key
 * validates it live server-side (a real token exchange) before storing.
 */
/**
 * The real Garmin Connect Developer Program (Starter Access, OAuth tier)
 * — separate from AthleteGarminCard below (the Personal API key-paste
 * flow). Mirrors AthleteCorosCard's Connect/Disconnect pattern exactly,
 * since this is also real OAuth. See CLAUDE.md's "Garmin Connect
 * Developer Program" section and lib/integrations/garminDeveloper.ts.
 */
function AthleteGarminDevCard({ name }: { name: string }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/garmin-dev/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/garmin-dev/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{name} · Garmin (Developer API)</CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }} />
        <span className="text-sm">{status?.connected ? (isEn ? "Connected" : "Conectado") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        {isEn
          ? "Real OAuth connection, can also push structured workouts to your watch. Its endpoints may not be fully configured yet. See CLAUDE.md."
          : "Conexión OAuth real, también puede mandar entrenos estructurados a tu reloj. Puede que sus endpoints todavía no estén totalmente configurados. Ver CLAUDE.md."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {status?.connected ? (
          <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
            {isEn ? "Disconnect" : "Desconectar"}
          </Button>
        ) : (
          <a href="/api/garmin-dev/connect">
            <Button size="sm">{isEn ? "Connect" : "Conectar"}</Button>
          </a>
        )}
      </div>
    </Card>
  );
}

function AthleteGarminCard({ name }: { name: string }) {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/garmin/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — see the same note in calendar/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(isEn ? "Garmin connected." : "Garmin conectado.");
        setApiKey("");
        await loadStatus();
      } else {
        setMessage(data.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/garmin/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{name} · Garmin (Personal key)</CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }} />
        <span className="text-sm">{status?.connected ? (isEn ? "Connected" : "Conectado") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        {isEn
          ? "Read-only, personal use only: this uses your own Garmin Personal API key to read your own data. It cannot push workouts to your watch (Garmin doesn't allow that for this type of key). For pushing structured workouts, use the Garmin (Developer API) card above."
          : "Solo lectura, uso personal: usa tu propia clave Personal API de Garmin para leer tus propios datos. No puede mandar entrenos a tu reloj (Garmin no lo permite con este tipo de clave). Para mandar entrenos estructurados, usa la tarjeta de Garmin (Developer API) arriba."}
      </p>

      {!status?.connected && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-2">
          <li>
            {isEn ? "Go to" : "Ve a"}{" "}
            <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener noreferrer" className="underline">
              connect.garmin.com/app/settings/personalApiToken
            </a>{" "}
            {isEn ? "(sign in to Garmin Connect first if asked)." : "(inicia sesión en Garmin Connect si te lo pide)."}
          </li>
          <li>{isEn ? "Click to generate a new Personal API key." : "Genera una nueva clave Personal API."}</li>
          <li>
            {isEn
              ? "Copy it immediately, Garmin only shows it once."
              : "Cópiala de inmediato, Garmin solo la muestra una vez."}
          </li>
          <li>{isEn ? "Paste it below and save." : "Pégala abajo y guarda."}</li>
        </ol>
      )}

      {message && <p className="mt-2 text-xs text-ink-2">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {status?.connected ? (
          <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
            {isEn ? "Disconnect" : "Desconectar"}
          </Button>
        ) : (
          <form onSubmit={save} className="flex w-full flex-wrap gap-2">
            <input
              type="password"
              required
              placeholder={isEn ? "Paste your Garmin Personal API key" : "Pega tu clave Personal API de Garmin"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10 min-w-[260px] flex-1 rounded-xl border border-line bg-bg px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? (isEn ? "Checking…" : "Verificando…") : isEn ? "Save" : "Guardar"}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
