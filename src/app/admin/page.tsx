"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/SiteHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Athlete } from "@/lib/types";

/**
 * Admin section — manage the roster. Per explicit instruction: "un botón
 * de admin en la plataforma, lo más a la derecha posible... donde
 * manejar los usuarios... añadir usuarios... una vez añadido el usuario
 * se manda una invitación a través de mail." See CLAUDE.md's "Real auth +
 * admin" section for the full design (invite flow, the no-request-needed
 * "Friends" model, why RLS came back to `authenticated`).
 */
export default function AdminPage() {
  const { t } = useLocale();
  const { me, refreshAthletes } = useAuth();
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/athletes");
    const data = await res.json();
    if (res.ok) setAthletes(data.athletes);
    else setError(data.error);
  }, []);

  useEffect(() => {
    if (me?.is_admin) {
      // Initial data fetch on mount — see the same note in calendar/page.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load();
    }
  }, [me, load]);

  async function afterChange() {
    await load();
    await refreshAthletes();
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="flex-1 px-6 pt-28 pb-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">Admin</h1>

          {!me ? (
            <p className="text-ink-3">{t("loading")}</p>
          ) : !me.is_admin ? (
            <p className="text-sm text-ink-2">Not authorized.</p>
          ) : (
            <>
              {error && <p className="mb-4 text-sm text-error">{error}</p>}
              <InviteNewAthlete onDone={afterChange} />
              <div className="mt-8">
                {athletes === null ? (
                  <p className="text-ink-3">{t("loading")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {athletes.map((a) => (
                      <AthleteRow key={a.id} athlete={a} me={me} onChange={afterChange} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function InviteNewAthlete({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/athletes/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setOpen(false);
      setName("");
      setEmail("");
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + Add athlete
      </Button>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-2">Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-xl border border-line bg-bg px-3 text-sm"
            />
          </div>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AthleteRow({ athlete, me, onChange }: { athlete: Athlete; me: Athlete; onChange: () => Promise<void> }) {
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState(athlete.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/athletes/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, existingAthleteId: athlete.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setInviting(false);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !athlete.is_admin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm font-semibold">
            {athlete.name}
            {athlete.id === me.id && <span className="ml-1.5 text-xs text-ink-3">(you)</span>}
          </p>
          <p className="text-xs text-ink-3">{athlete.email ?? "—"}</p>
        </div>
        {athlete.is_admin && (
          <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">Admin</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {athlete.auth_user_id ? (
            <Button size="sm" variant="steel" onClick={toggleAdmin} disabled={busy}>
              {athlete.is_admin ? "Remove admin" : "Make admin"}
            </Button>
          ) : inviting ? null : (
            <Button size="sm" onClick={() => setInviting(true)}>
              Send invite
            </Button>
          )}
        </div>
      </div>

      {!athlete.auth_user_id && (
        <div className="mt-2 flex items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ink-3" />
          <span className="text-xs text-ink-3">No account yet</span>
        </div>
      )}

      {inviting && (
        <form onSubmit={sendInvite} className="mt-3 flex items-center gap-2">
          <input
            required
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 flex-1 rounded-xl border border-line bg-bg px-3 text-sm"
          />
          <Button type="submit" size="sm" disabled={busy}>
            Send
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setInviting(false)}>
            Cancel
          </Button>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </Card>
  );
}
