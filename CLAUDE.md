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

**Auth is deliberately switched off for now** (explicit product decision,
Oct 2026 — "quita el tema de la autenticacion por el momento, no
necesitamos claves ahorita"). The app has no sign-in page; every page loads
straight in. This was a real reversal, not the original design — see the
RLS note in `supabase/schema.sql` for the full rationale, the exact
tradeoff being accepted, and how to revert it later. What changed
concretely:

- `athletes` — still a fixed roster of exactly two rows (`juan`, `jose`),
  seeded by `supabase/schema.sql`. `auth_user_id` still exists and is
  already linked for José (from when auth was on), but **nothing in the
  app reads it anymore** — it's inert until auth is turned back on.
- `workouts`, `templates`, `strava_activities` (select) — RLS policies
  grant `anon` the same access as `authenticated` (see `schema.sql` /
  `supabase/migrations/002_disable_auth_rls_gate.sql`), so every page works
  with nobody signed in. This means **anyone with the deployed URL can read
  and write every workout/template** — accepted only because this app
  isn't publicly shared or indexed. The "Juan / José / Both" switch in the
  header (`src/lib/athlete-view-context.tsx`) was always a view filter, not
  a security boundary, and still is.
- `strava_connections` — real OAuth access/refresh tokens. RLS enabled with
  **no policies at all**, service-role only, same strictness pattern the
  Operations Hub codebase uses for every secret-holding table
  (`order_tracking_links`, `sa_reviews`, etc.) — **unaffected by turning
  auth off**, still completely locked to the server. Never read or written
  from the browser — `src/app/api/strava/status/route.ts` is the only way
  the UI learns whether an athlete is connected, and it deliberately
  returns only `{connected, connectedAt, lastSyncedAt}`, never the tokens.

## Strava integration

- One Strava API app (`STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET`), but each
  athlete authorizes it **separately** — per explicit product decision,
  not a single shared Strava account. `src/lib/integrations/strava.ts`
  builds the authorize URL with `state` set to the athlete's own id (not a
  cookie — the Strava redirect is a fresh top-level navigation with no
  session context of its own), so `/api/strava/callback` knows which
  athlete just connected.
- Every Strava route (`connect`, `status`, `sync`, `disconnect`) takes an
  explicit **athlete slug** — `?athlete=juan|jose` on the two GETs,
  `{athleteSlug}` in the POST bodies — resolved by
  `getAthleteBySlug()` in `src/lib/auth.ts`, instead of a signed-in
  session (there isn't one right now). `/settings` shows both athletes as
  separate cards, each with its own Connect/Sync/Disconnect, rather than
  acting on "whoever is signed in." If auth comes back, this is the one
  spot that would need to go back to deriving the athlete from the
  session instead of trusting a client-supplied slug — right now nothing
  stops Juan from clicking "Connect" on José's card by hand, which is
  fine only because this app isn't exposed beyond the two of them.
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

## Manual setup steps

1. **Create a Supabase project** (supabase.com), then run
   `supabase/schema.sql` once in its SQL editor (and
   `supabase/migrations/002_disable_auth_rls_gate.sql` if `schema.sql` was
   already applied before auth was turned off — a fresh run of `schema.sql`
   alone already includes it). Copy the project URL and anon key into
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the
   service-role key into `SUPABASE_SERVICE_ROLE_KEY` (Settings -> API).
   These are env vars only — never commit them.
2. ~~Create two Supabase Auth users and link them~~ — **not needed while
   auth is off.** José's account (`josemiguel.espi188@gmail.com`) already
   exists and is linked from when this was briefly tried; it's simply
   unused by the app right now. Skip straight to step 3.
3. **Create a Strava API app** at
   <https://www.strava.com/settings/api> — "Authorization Callback Domain"
   must be this app's real deployed domain (no `https://`, no path, e.g.
   `cadencia.vercel.app`), or Strava will refuse the OAuth redirect. Copy
   the Client ID/Secret into `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.
4. **Set `NEXT_PUBLIC_SITE_URL`** to this app's real deployed origin (no
   trailing slash) — it's used to build the Strava `redirect_uri`, so it
   has to match the callback domain from step 3 exactly or Strava's
   authorize step will fail.
5. **Deploy to Vercel**, set all of the above as env vars there (Project
   Settings -> Environment Variables), matching the `.env.example` names
   exactly.

Everything above is a one-time setup cost; once done, both athletes land
straight in `/calendar`, connect their own Strava from `/settings`, and
every page works with no further manual steps.

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.
