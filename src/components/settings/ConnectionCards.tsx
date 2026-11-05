"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Athlete } from "@/lib/types";
import { parsePace } from "@/lib/dates";

/**
 * The zones card + every per-athlete connection card — extracted out of
 * `/settings` (Nov 2026) so the new `/onboarding` wizard can reuse the
 * exact same components instead of duplicating six cards' worth of
 * fetch/connect/disconnect logic. Each card still derives "which
 * athlete" from the signed-in session itself (no props needed, except
 * `AthleteZonesCard`'s `slug`), so they work identically wherever
 * they're rendered.
 */

interface StravaStatus {
  connected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
}

/**
 * Mirrors AthleteStravaCard exactly — WHOOP's public API is pull-only
 * (no webhook/push capability in the real spec pasted into this session,
 * see lib/integrations/whoop.ts's file header), so "Sync now" is the
 * only path, same as Strava.
 */
export function AthleteWhoopCard() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/whoop/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/whoop/sync", { method: "POST" });
      const data = await res.json();
      const summary = res.ok
        ? isEn
          ? `Synced ${data.cycles} cycles · ${data.sleeps} sleeps · ${data.recoveries} recoveries · ${data.workouts} workouts.`
          : `${data.cycles} ciclos · ${data.sleeps} sueños · ${data.recoveries} recuperaciones · ${data.workouts} entrenos sincronizados.`
        : data.error;
      const errorSuffix = data.errors?.length ? ` ${isEn ? "Some writes failed:" : "Algunas escrituras fallaron:"} ${data.errors.join(", ")}` : "";
      setMessage(summary + errorSuffix);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/whoop/disconnect", { method: "POST" });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>WHOOP</CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }} />
        <span className="text-sm">{status?.connected ? (isEn ? "Connected" : "Conectado") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      {status?.connected && (
        <p className="mt-1 text-xs text-ink-3">
          {isEn ? "Last sync" : "Última sincronización"}: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString(locale) : isEn ? "never" : "nunca"}
        </p>
      )}

      {message && <p className="mt-2 text-xs text-ink-2">{message}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {status?.connected ? (
          <>
            <Button size="sm" onClick={sync} disabled={busy}>
              {isEn ? "Sync now" : "Sincronizar ahora"}
            </Button>
            <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
              {isEn ? "Disconnect" : "Desconectar"}
            </Button>
          </>
        ) : (
          <a href="/api/whoop/connect">
            <Button size="sm">{isEn ? "Connect WHOOP" : "Conectar WHOOP"}</Button>
          </a>
        )}
      </div>
    </Card>
  );
}

export function AthleteStravaCard() {
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
      <CardTitle>Strava</CardTitle>

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
 * Real Connect/Disconnect UI — COROS's real API endpoints are still
 * unconfirmed (see lib/integrations/coros.ts's file header), so clicking
 * Connect before COROS_CLIENT_ID/COROS_AUTHORIZE_URL/etc. are set on
 * Vercel returns a clear "not configured" error, same maturation path
 * Strava went through before its own env vars were set. No "Sync now"
 * button here — COROS only has a push capability planned (per-workout,
 * from the workout dialog), not a pull/sync like Strava's.
 */
export function AthleteCorosCard() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<{ toolsCatalog: unknown; capturedAt: string | null } | "loading" | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function loadCatalog() {
    setCatalog("loading");
    const res = await fetch("/api/coros/tools-catalog");
    setCatalog(res.ok ? await res.json() : null);
  }

  async function copyCatalog() {
    if (catalog && catalog !== "loading" && catalog.toolsCatalog) {
      await navigator.clipboard.writeText(JSON.stringify(catalog.toolsCatalog, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card>
      <CardTitle>COROS</CardTitle>

      <div className="mt-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: status?.connected ? "var(--success)" : "var(--ink-3)" }} />
        <span className="text-sm">{status?.connected ? (isEn ? "Connected" : "Conectado") : isEn ? "Not connected" : "No conectado"}</span>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        {isEn
          ? "Real COROS MCP connection (no approval needed). Pushing structured workouts isn't built yet — the exact payload format COROS expects still needs confirming. See CLAUDE.md."
          : "Conexión real a COROS MCP (no necesita aprobación). Mandar entrenos estructurados todavía no está construido — falta confirmar el formato exacto que espera COROS. Ver CLAUDE.md."}
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
        {status?.connected && !catalog && (
          <Button size="sm" variant="ghost" onClick={loadCatalog}>
            {isEn ? "View captured schema" : "Ver esquema capturado"}
          </Button>
        )}
      </div>

      {/* Debug/dev surface, not an athlete-facing feature — shows the raw
          MCP tools/list response captured on connect
          (coros_connections.tools_catalog), so the real `course` payload
          schema can be read and pasted back for implementing
          pushStructuredWorkoutToCorosMcp() for real. See CLAUDE.md. */}
      {catalog === "loading" ? (
        <p className="mt-4 text-xs text-ink-3">{isEn ? "Loading…" : "Cargando…"}</p>
      ) : catalog ? (
        !catalog.toolsCatalog ? (
          <p className="mt-4 text-xs text-ink-3">
            {isEn
              ? "Nothing captured yet — try disconnecting and reconnecting COROS."
              : "Todavía no hay nada capturado — prueba desconectar y volver a conectar COROS."}
          </p>
        ) : (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-ink-3">
                {isEn ? "Captured" : "Capturado"} {catalog.capturedAt ? new Date(catalog.capturedAt).toLocaleString(locale) : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={copyCatalog}>
                {copied ? (isEn ? "Copied!" : "¡Copiado!") : isEn ? "Copy" : "Copiar"}
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-bg p-3 text-[11px] leading-snug text-ink-2">
              {JSON.stringify(catalog.toolsCatalog, null, 2)}
            </pre>
          </div>
        )
      ) : null}
    </Card>
  );
}

export function AthleteZonesCard({ slug }: { slug: string }) {
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
          // Pass the raw values, not pre-defaulted to "0" — parsePace()
          // now distinguishes a genuinely blank field (invalid, rejects)
          // from a real 0; pre-defaulting here would defeat that check.
          threshold_pace_sec_per_km: parsePace(paceMin, paceSec),
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
      <CardTitle>{t("zones_h")}</CardTitle>

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
 * The real Garmin Connect Developer Program (Starter Access, OAuth tier)
 * — separate from AthleteGarminCard below (the Personal API key-paste
 * flow). Mirrors AthleteCorosCard's Connect/Disconnect pattern exactly,
 * since this is also real OAuth. See CLAUDE.md's "Garmin Connect
 * Developer Program" section and lib/integrations/garminDeveloper.ts.
 */
export function AthleteGarminDevCard() {
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
      <CardTitle>Garmin (Developer API)</CardTitle>

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
export function AthleteGarminCard() {
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
      <CardTitle>Garmin (Personal key)</CardTitle>

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
            <a
              href="https://connect.garmin.com/app/settings/personalApiToken"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline"
            >
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
