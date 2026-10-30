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

## Roadmap — becoming a TrainingPeaks-style platform (Oct 2026)

The real goal of this app, per explicit instruction, is bigger than "a
shared training log": Juan and José want to train in sync, see each
other's progress, build their own personalized plans toward a specific
goal, and eventually get a TrainingPeaks-grade dashboard (training
effectiveness, effort rating, AI insights) — all in the Zenit/
CarbsNutrition visual language this app already uses. Four mechanism
decisions were confirmed explicitly (`AskUserQuestion`) before building
any of this, since guessing wrong on any of them would have meant
building the wrong integration entirely:

1. **Weekly plan delivery is a downloadable `.ics` file, not SMS/WhatsApp
   and not a live Google Calendar OAuth push.** Twilio-style SMS was
   explicitly declined (cost + a new account to provision, like Resend
   was for Communications), and so was a Google Calendar API integration
   for this first pass — simpler wins: each athlete downloads their own
   week's file and imports it into their own calendar app by hand. This
   also directly serves the user's own stated priority ("no quiero que te
   enfoques en hacer el entrenamiento sino en codear que todo esté
   perfecto para luego poder cargar el entrenamiento") — the one thing
   that has to be right is the export pipeline (stable ids so
   re-importing an edited week updates events instead of duplicating,
   and rich per-workout descriptions explaining the workout's purpose),
   not any particular week's actual training content.
2. **Each athlete's export is scoped to themselves** — when both
   confirmed "cada atleta conecta su propia cuenta Google," that's
   really about where the file lands (each athlete's own personal
   calendar), which applies the same way to a manually-imported `.ics`
   file as it would to a live OAuth push. The export therefore always
   respects the calendar's own athlete filter (`who` from
   `athlete-view-context.tsx`) — exporting while "Both" is selected
   produces one file with both athletes' workouts (each tagged with
   their initials in the event title), exporting while a single athlete
   is selected produces that athlete's workouts only.
3. **Strava write-back (pushing an AI-generated description onto the
   matching Strava activity) will run fully automatically the moment a
   sync happens** — no draft/approve step, per explicit choice ("qué
   lo haga automático apenas sincroniza... más rápido, menos control").
   Not built yet (see priority order below) — when it is, this preference
   means `/api/strava/sync` itself should call the description-generation
   step and push back to Strava's API inline, not a separate
   human-in-the-loop review screen.
4. **Build order, explicitly confirmed**: (1) the weekly `.ics` export
   pipeline first — **done**, see below; (2) Strava auto-complete
   (marking a planned workout "done" from a matching synced activity —
   deliberately left out of the original sync route, see "Strava
   integration" above) plus the auto-write-back description; (3) the
   TrainingPeaks-style dashboard (effectiveness, effort rating, AI
   insights) last, since it needs real synced data flowing first to be
   meaningful rather than a shell with no numbers behind it. Don't jump
   ahead to (2) or (3) without this file saying they're done being
   built, or without a fresh explicit instruction to reprioritize.

### Weekly `.ics` export (built)

`src/lib/ics.ts`'s `buildWeekIcs()` generates one `.ics` file for
whichever workouts are visible on the Calendar page (respects the `who`
filter), for the currently visible week — a "Download week" button in
the Toolbar (`src/app/calendar/page.tsx`). Each workout becomes one
`VEVENT`:

- A **stable `UID`** (`${workout.id}@cadencia`) — re-downloading the same
  week after editing a workout produces an event with the same UID, so
  re-importing it updates the existing calendar event instead of
  duplicating it (standard iCalendar behavior; Apple Calendar honors this
  reliably on a plain `.ics` import, Google Calendar's import flow is
  less consistent about it — worth confirming empirically once real
  weeks are actually being imported, not just assumed from the RFC).
- **Timed if `start` is set** (`DTSTART`/`DTEND` from `date`+`start`,
  duration = `minutes`, defaulting to 60 if `minutes` is 0), **all-day
  otherwise**.
- **`SUMMARY`** is `sport: title`, prefixed with the athlete's initials
  only when the export covers both athletes (no prefix needed for a
  single-athlete export — redundant with every other event in that same
  file).
- **`DESCRIPTION`** is the workout's own `notes` field plus `km` if set —
  **this is the field that has to carry the workout's actual purpose**
  per the user's explicit requirement ("tiene que en notas explicar
  exactamente lo que hace cada entrenamiento, cuál es el objetivo") — no
  new dedicated "objective" field was added for this, `notes` already
  exists and is free text, so reusing it was the minimal change; revisit
  only if a structured objective field turns out to be worth splitting
  out from free-form notes once real weeks are being written.

Nothing server-side was needed for this — the calendar page already has
every workout loaded client-side, so the `.ics` text is built and handed
to the browser as a download (`Blob` + a synthetic `<a download>` click)
entirely in the browser, no new API route.

### Training-zone thresholds (built, Oct 2026)

Four numbers per athlete — **LTHR** (lactate threshold heart rate, bpm),
**running threshold pace** (what the user calls their "race predictor",
sec/km), **bike FTP** (watts), and **VO2max** (ml/kg/min) — are now
editable from a "Training zones" card on `/settings`, one per athlete,
above the existing Strava card. Columns on `athletes`
(`threshold_hr`, `threshold_pace_sec_per_km`, `ftp_watts`, `vo2max`),
added by `supabase/migrations/003_athlete_training_zones.sql` — **needs
this migration run in the SQL editor** (a fresh `schema.sql` run already
includes these columns). Saved with a direct browser-side
`supabase.from("athletes").update(...)` call, same RLS-is-open-to-anon
pattern every other write in this app already uses (see "Data model &
auth" above) — no new API route needed.

**These four numbers are explicitly the input layer for two much bigger
features that are NOT built yet** — don't start either without a fresh
go-ahead, they're real scope on their own:

1. **AI-generated training plans**: per the user's own framing, "el
   cloud... según este predictor... va editándose los entrenamientos por
   persona" — a plan-generation step that reads these thresholds (and
   presumably recent Strava activity/progress) and writes/adjusts
   `workouts` rows automatically. Needs its own design pass: which
   provider, how often it runs, whether it proposes a draft for approval
   or writes directly (unlike the Strava-description write-back decision
   above, this wasn't confirmed either way yet), and how it reconciles
   with an athlete's own manually-added workouts.
2. **A virtual coach agent**: a conversational interface where editing a
   plan happens through back-and-forth chat rather than the form-based
   calendar/dialog UI that exists today. Also entirely undesigned —
   where it lives in the UI, what it can actually change, how it relates
   to (1) above (does the chat drive the same generator, or is it a
   separate path to editing `workouts` directly).

One open question worth confirming before either of those gets designed:
`threshold_pace_sec_per_km` is stored as a single pace value (seconds per
km) on the assumption that "race predictor" means a threshold/representative
pace, not a structured recent-race-result (distance + time) that a VDOT-style
calculator would use to derive paces for other distances. If the real intent
is the latter, this column's shape would need to change before anything
downstream (plan generation) starts depending on it.

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.
