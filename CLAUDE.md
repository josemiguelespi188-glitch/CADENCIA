# Cadencia — project notes

Training log for two athletes, Juan and José Miguel — a calendar of planned
workouts (swim/bike/run/gym/race), a dashboard, a template library, and a
per-athlete Strava connection that syncs real activity data (pace, distance,
cadence) alongside the plan. Built on the same stack as the Operations Hub
(`josemiguelespi188-glitch/operationslanding`): Next.js (App Router) +
Supabase + Vercel, plus the Strava API.

## Design system

Deliberately shares its visual language with `josemiguelespi188-glitch/
carbsnutrition` (the "Zenit" nutrition app): monochrome ink/surface/line
tokens in `src/app/globals.css`, IBM Plex Sans + JetBrains Mono, pill
buttons (`src/components/ui/button.tsx`), `rounded-2xl` cards
(`src/components/ui/card.tsx`), uppercase-tracked micro-labels, and a
manual (not OS-driven) dark mode toggle persisted in `localStorage`
(`cadencia-theme`, mirroring Zenit's own `zenit-theme` key but under its
own name so the two apps' toggles don't collide if ever opened in the same
browser profile).

The one deliberate departure from Zenit: where Zenit uses a single sparing
accent color, Cadencia has **one accent per sport** (`--swim`, `--bike`,
`--run`, `--gym`, `--race` in `globals.css`, consumed via the `.s-<sport>`
utility classes that set `--c`/`--soft`) — the whole point of the app is
telling sports apart at a glance on a shared two-athlete calendar, so a
single accent wouldn't work here the way it does for Zenit's single-person
flows. Everything else (ink grayscale, card/button shapes, typography)
stays identical on purpose so the two apps read as one family.

## Data model & auth

- `athletes` — a fixed roster of exactly two rows (`juan`, `jose`), seeded
  by `supabase/schema.sql`. There is no self-signup. `auth_user_id` links a
  row to a real Supabase Auth user — **this link has to be set by hand**
  (see setup steps below); until it is, that person can sign in but the app
  treats them as "no athlete attached."
- `workouts`, `templates` — shared between both athletes. Any signed-in
  athlete can read and write both athletes' workouts/templates (RLS policy
  `for all to authenticated using (true)`) — this is a shared coach log,
  not a siloed multi-tenant app. The "Juan / José / Both" switch in the
  header (`src/lib/athlete-view-context.tsx`) is a **view filter only**,
  never a security boundary.
- `strava_connections` — real OAuth access/refresh tokens. RLS enabled with
  **no policies at all**, service-role only, same strictness pattern the
  Operations Hub codebase uses for every secret-holding table
  (`order_tracking_links`, `sa_reviews`, etc.). Never read or written from
  the browser — `src/app/api/strava/status/route.ts` is the only way the
  UI learns whether an athlete is connected, and it deliberately returns
  only `{connected, connectedAt, lastSyncedAt}`, never the tokens.
- `strava_activities` — a cache of activities pulled from Strava's API,
  written only by the service-role sync route. Readable by any
  authenticated athlete (so the dashboard can show both athletes' recent
  activity), but not writable from the browser.

## Strava integration

- One Strava API app (`STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET`), but each
  athlete authorizes it **separately** — per explicit product decision,
  not a single shared Strava account. `src/lib/integrations/strava.ts`
  builds the authorize URL with `state` set to the athlete's own id (not a
  cookie — the Strava redirect is a fresh top-level navigation with no
  session context of its own), so `/api/strava/callback` knows which
  athlete just connected.
- `/api/strava/connect` always acts on **whoever is currently signed in**
  — there is no "connect for athlete X" picker anywhere, by design, so one
  athlete can never accidentally connect the other's Strava account to
  their row.
- `/api/strava/sync` pulls that athlete's most recent 50 activities and
  upserts them into `strava_activities`. **It does not attempt to
  auto-match a synced activity to a specific planned `workouts` row** —
  matching by date+sport alone is guesswork (two easy runs logged the same
  day, a workout done a day late, etc.). V1 shows real Strava activity
  alongside the plan (dashboard's "Strava" section) rather than merging
  them; auto-linking (and marking a workout "done" from a matching
  activity) is a reasonable next step if it's wanted, but was deliberately
  left out rather than guessed at.
- Sync is manual (a "Sync now" button on `/settings`) — there's no
  scheduled/webhook sync in this first pass. Strava does support
  subscription webhooks (`POST /push_subscriptions`) the same way ClickUp's
  webhook is registered in the Operations Hub codebase; add that later if
  manual sync turns out to be too much friction.

## Manual setup steps (none of this exists yet until it's done by hand)

This repo is code only — nothing below is provisioned yet.

1. **Create a Supabase project** (supabase.com), then run
   `supabase/schema.sql` once in its SQL editor. Copy the project URL and
   anon key into `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   and the service-role key into `SUPABASE_SERVICE_ROLE_KEY` (Settings ->
   API). These are env vars only — never commit them.
2. **Create the two Supabase Auth users** for Juan and José (Authentication
   -> Users -> Add user, in the Supabase dashboard — set a password for
   each, or use "Send invite" if email sending is configured for the
   project).
3. **Link each Auth user to their `athletes` row** — run in the SQL
   editor, once per athlete, after step 2:
   ```sql
   update athletes set auth_user_id = '<juan-auth-user-uuid>' where slug = 'juan';
   update athletes set auth_user_id = '<jose-auth-user-uuid>' where slug = 'jose';
   ```
   Without this, that person can sign in at `/auth` but every page treats
   them as unattached (no athlete-scoped data, Strava connect redirects to
   sign-in).
4. **Create a Strava API app** at
   <https://www.strava.com/settings/api> — "Authorization Callback Domain"
   must be this app's real deployed domain (no `https://`, no path, e.g.
   `cadencia.vercel.app`), or Strava will refuse the OAuth redirect. Copy
   the Client ID/Secret into `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.
5. **Set `NEXT_PUBLIC_SITE_URL`** to this app's real deployed origin (no
   trailing slash) — it's used to build the Strava `redirect_uri`, so it
   has to match the callback domain from step 4 exactly or Strava's
   authorize step will fail.
6. **Deploy to Vercel**, set all of the above as env vars there (Project
   Settings -> Environment Variables), matching the `.env.example` names
   exactly.

Everything above is a one-time setup cost; once done, both athletes sign
in at `/auth`, connect their own Strava from `/settings`, and the
calendar/dashboard/templates pages work with no further manual steps.

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.
