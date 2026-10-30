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
  upserts them into `strava_activities`.
- Sync is manual (a "Sync now" button on `/settings`) — there's no
  scheduled/webhook sync in this first pass. Strava does support
  subscription webhooks (`POST /push_subscriptions`) the same way ClickUp's
  webhook is registered in the Operations Hub codebase; add that later if
  manual sync turns out to be too much friction.

### Auto-complete + AI description write-back (built, Oct 2026)

Step 2 of the confirmed build order (see "Roadmap" below). Every sync now
also processes any `strava_activities` row with `description_written_at
is null` — not just the ones just fetched, so a prior failed attempt
(e.g. Claude briefly down) gets retried on the next sync too:

- **Auto-complete is deliberately conservative.** The original V1 note
  above ("matching by date+sport alone is guesswork") is still true, so
  the match only fires when there is **exactly one** un-linked planned
  `workouts` row for that athlete on the same **local** calendar day
  (`strava_activities.local_date`, from Strava's `start_date_local` —
  NOT `start_date`, which is UTC and can land on the wrong day) and the
  same mapped sport. Zero or multiple candidates are left alone for
  manual review rather than guessed at. A match sets `done = true` and
  `strava_activity_id` on the matched `workouts` row.
- **The AI write-back always runs**, independent of whether a match was
  found — per the earlier confirmed decision ("qué lo haga automático
  apenas sincroniza"), fully automatic, no draft/approve step.
  `src/lib/integrations/claude.ts`'s `generateActivityDescription()`
  calls the Claude API directly (`ANTHROPIC_API_KEY`, model pinned to
  `claude-sonnet-5-5` in that file) with the activity's own data, plus
  the matched workout's `notes` (its stated objective) when there is one
  — same best-effort pattern as every other optional AI/notification
  step in this codebase (Communications' approval emails, Support
  Inquiry's AI explain): missing key or a failed call just skips the
  write silently (`console.error`'d), never blocks sync or
  auto-complete. The result is written back onto the real Strava
  activity via `updateStravaActivityDescription()` (`PUT
  /activities/{id}`, requires the `activity:write` scope — added to the
  OAuth authorize URL in this same pass; safe to widen without
  re-auth since nobody had connected yet when this scope changed).
- `description_written_at` is set after every attempt, success or
  failure — so a permanent failure (e.g. no `ANTHROPIC_API_KEY` set at
  all) doesn't get retried forever, same tradeoff as everywhere else in
  this codebase that uses a "processed at" timestamp for a best-effort
  step.
- Not yet tested against real Strava data (no athlete has connected
  Strava from this sandbox) — confirm once deployed: that the OAuth
  consent screen actually shows the write permission, that a same-day
  same-sport match correctly flips a workout to done, and that the
  written-back description actually shows up on the real Strava
  activity page.

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
   (marking a planned workout "done" from a matching synced activity)
   plus the auto-write-back description — **done**, see "Auto-complete +
   AI description write-back" under "Strava integration" above; (3) the
   TrainingPeaks-style dashboard (effectiveness, effort rating, AI
   insights) is next, since it needs real synced data flowing first to be
   meaningful rather than a shell with no numbers behind it — now that
   (2) is in place, this is the one still-undone piece of the original
   three. The AI-generated-plans and virtual-coach-agent items further
   below are separate, later work, not part of this three-item order.

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

### Pastel palette, real Strava zones, and an expanded dashboard (Oct 2026)

After José actually connected his Strava account and tested the app live,
a round of direct feedback (with a COROS dashboard screenshot as a visual
reference) led to several changes:

- **Sport accent colors are now deliberately pastel/muted**, not the
  original saturated hues — per explicit feedback ("colores pasteles...
  no tan heavies"). `--error` (strong red) and the new `--success`
  (strong green) token in `globals.css` are reserved exclusively for
  genuine alert/success states (a failed sync, a real warning) — **never**
  used as a routine sport-color dot or chip. The base app stays
  white/gray exactly as before; only the sport hues themselves got
  softer.
- **Sync now pulls the last 30 days, fully paginated** (`days` param on
  `fetchRecentStravaActivities()` in `lib/integrations/strava.ts`, replacing
  the old flat "most recent 50" cap) — per explicit instruction ("no
  necesito lo histórico, solamente el último mes"). No deep history by
  design; revisit if a longer window is ever wanted.
- **Sync also pulls the athlete's real zones from Strava itself**
  (`fetchStravaAthleteZones()`, `GET /athlete/zones`) when the athlete has
  any configured there — stored on `athletes.strava_hr_zones` /
  `strava_power_zones` (migration 005). This is the literal "sacar...
  el threshold, rate zone, el FTP... de Strava" ask — real data when
  Strava has it, **not** a guess. Most athletes never configure zones in
  Strava's own app though, so the common case is still the
  manually-entered thresholds from the "Training zones" card.
- **`lib/zones.ts`** computes HR/pace/power zone tables from an athlete's
  threshold values, used as the fallback whenever Strava has no zones of
  its own (and always for pace, since Strava's zones endpoint has no pace
  zones at all). This is the **standard, published %-of-threshold model**
  from Allen & Coggan's "Training and Racing with a Power Meter" — not a
  reverse-engineered copy of COROS's (or any other platform's)
  proprietary, undocumented zone algorithm, which there isn't enough
  public spec to replicate honestly from a single reference screenshot.
  `components/ZoneTables.tsx` renders all three (HR/pace/power), labeled
  "De Strava" vs "Calculadas" so it's always clear which source a given
  table came from — reused on both `/settings` (per-athlete, editable
  context) and `/dashboard` (read-only, only when a single athlete is
  selected — zones aren't meaningful for "Both" at once).
- **The calendar now shows real Strava activity that has no matching
  plan**, not just linked ones — per explicit instruction. Any synced
  activity not referenced by a `workouts.strava_activity_id` renders as
  its own dashed-border chip (vs. the planned chip's solid soft
  background — the visual cue that this happened but wasn't planned) on
  both week and month views, scoped to the same last-30-days window sync
  itself uses.
- **The dashboard gained**: a real "Recent activities" table (date,
  duration, distance, avg HR + %LTHR when a threshold is set, cadence —
  `strava_activities.average_heart_rate` is new, migration 006, from
  Strava's `average_heartrate`), the zone tables, and a "Best efforts
  (last 30 days)" panel (`lib/bestEfforts.ts` — fastest pace per standard
  running distance, 5K/10K/21K/42K within a tolerance, from whatever's
  synced). **Deliberately NOT added**: anything resembling COROS's
  "Training Status," "Recovery %," "7-Day Efficiency Score," or
  overnight HRV widgets — those come from COROS's own watch sensors and
  proprietary algorithms, and Strava's API exposes none of it. Fabricating
  plausible-looking numbers for them would be actively dishonest, so
  they're skipped entirely rather than faked — the user's own message
  acknowledged this tradeoff ("obviamente no vamos a tener tanta
  información"). "Best efforts" is also deliberately never called
  "Personal Record" in the UI, since it only ever sees the last 30 days,
  not real all-time PRs.
- `mapStravaSportType()` moved from `lib/integrations/strava.ts` to a new
  `lib/sport.ts` — it's a pure function with no server dependency, but
  `strava.ts` imports the service-role Supabase client (which itself
  pulls in `next/headers`), so importing anything from `strava.ts` into
  a `"use client"` page (the Calendar page needs this to color-code
  unmatched activity chips) broke the client bundle. Keep any future
  pure Strava helper that a client component needs in `sport.ts`, not
  `strava.ts`.
- **Migrations 005 and 006 need to be run in the SQL editor** before any
  of this works against the live project — not yet confirmed against
  real Strava zone data from this sandbox (`clickup.com`-style network
  restriction doesn't apply here, but no live Strava connection exists
  to test against from this environment either); confirm once deployed
  that a real `/athlete/zones` response renders correctly and that
  average_heartrate actually arrives for activities that recorded it.

### Excel weekly-plan import (Oct 2026)

A "Plan semanal (Excel)" panel at the top of `/calendar` — download a
template, fill it out (any number of workouts, any week), upload it
back, every row becomes a real `workouts` row immediately. Built per
explicit, detailed spec ("tiene que contar con absolutamente todo...
las horas... las notas... el comentario que va a ir en Strava...").

- **`exceljs`** generates and parses the `.xlsx` — deliberately **not**
  done in the browser: it pulls in Node built-ins, which broke the
  client bundle the same way `lib/integrations/strava.ts` did for
  `mapStravaSportType()` (see that note above). Both the template
  download (`GET /api/plan/template`) and the import
  (`POST /api/plan/import`) are server routes;
  `src/lib/excelPlan.ts` (the actual build/parse logic) is never
  imported from a `"use client"` file.
- **Template columns**: Atleta, Fecha, Deporte, Hora inicio, Hora fin,
  Minutos (used only if no times), Título, Tipo de entreno, Distancia,
  Notas, Comentario para Strava, Hecho — Atleta/Deporte/Hecho get real
  Excel dropdown data validation (rows 2-200) so typos can't slip past
  the import's matching logic. A second "Notas"/"Notes" sheet explains
  each column in plain language. **The example row has to be added
  BEFORE the data-validation loop runs** — found live (a round-trip
  test caught it before shipping): setting `dataValidation` on a cell
  materializes that row even with no value, so adding the example row
  afterward pushed it to row 201 instead of row 2.
- **Start/End time wins over Minutes when both are given** — `minutes`
  is computed from the time difference; the Minutes column exists for
  workouts with no fixed clock time (e.g. gym). Time-of-day cells are
  read defensively (`cellToTimeStr` in `excelPlan.ts`) since Excel may
  hand back a `Date` object (epoch 1899-12-30, read via UTC getters —
  the standard exceljs gotcha), a bare numeric day-fraction, or a plain
  "HH:MM" string depending on how the cell was typed/formatted.
- **Athlete and sport names are matched case-insensitively against
  either the display label or the internal slug/key** (`matchAthlete`/
  `matchSport`), so "Juan", "juan", "José Miguel", or "jose" all
  resolve the same way — doesn't assume the dropdown was actually used.
- **Every invalid row is reported with its exact row number and reason,
  never silently dropped or guessed** — unrecognized athlete/sport,
  bad date format, missing title. Valid rows still import even when
  other rows in the same file have errors; `PlanImportPanel.tsx` shows
  the count imported plus a list of what failed and why.
- **Import always INSERTs, never updates/matches existing rows** — the
  simplest behavior that fits "load a week once." Re-uploading the same
  file twice creates duplicate workouts; no dedup logic was built for
  this pass. Fine for the intended use; revisit only if re-uploading
  turns out to be a common need.
- `workouts` gained two columns to support this (migration 007,
  needed for both the Excel import and the dialog form below):
  **`strava_comment`** (a human-written summary meant to go verbatim
  onto the matched Strava activity, taking priority over the
  AI-generated one — `/api/strava/sync` now checks this before calling
  Claude at all) and **`workout_type`** (free-text, e.g. "Tempo",
  "Series" — purely descriptive, not a controlled vocabulary). Both are
  also editable directly from `WorkoutDialog.tsx` for a single workout,
  not just via bulk Excel import.

### What else Strava gives us (Oct 2026)

Per explicit question ("qué métricas falta que me dé Strava... quiero
tener todas"), two tiers:

- **Already captured in `raw jsonb` on every synced activity, just not
  previously surfaced as their own columns** — added for free, no new
  API call (migration 008): **Relative Effort** (`raw.suffer_score` →
  `relative_effort` — Strava's own proprietary intensity/effort score,
  genuinely useful as the "intensity" signal without this codebase
  inventing one), total elevation gain, max heart rate, average power
  (rides with a power meter), and calories (from `raw.kilojoules`).
  Shown in `ActivityDetailDialog.tsx` (when present on that activity)
  and as a new "Relative Effort" column in the dashboard's Recent
  Activities table.
- **Built (Oct 2026, second pass)**: `GET /athletes/{id}/stats` (recent
  4wk / YTD / all-time totals per sport — real Strava aggregation, not
  computed by us) and `GET /athlete` (just `weight`, used nowhere yet
  but stored for when power zones might want real body weight). New
  columns `athletes.strava_weight_kg` / `strava_stats`
  (migration 009), pulled every sync right after zones, same
  best-effort/non-blocking pattern. `components/StravaTotals.tsx`
  renders it on `/dashboard` (single-athlete view only, same as zones)
  — a plain table, recent/YTD/all-time × run/ride/swim, distance + time.
  `fetchStravaAthleteProfile()`'s own response also gives the real
  Strava athlete id, which `fetchStravaAthleteStats()` needs and which
  this codebase otherwise never stores (only `strava_connections.
  strava_athlete_id`, set once at connect time — fetching it fresh each
  sync avoids an extra query).
- **Still not built, still needs confirmation before starting**: the
  GPS route/map (`map.summary_polyline` on each activity) — would need
  a mapping library, clearly the largest of what's left.

### Dialog centering bug (found + fixed, Oct 2026)

Every native `<dialog>` in this app (`WorkoutDialog`,
`ActivityDetailDialog`, the inline one on `/templates`) was rendering
pinned to the top-left instead of centered — reported live with a
screenshot. Root cause: `dialog:modal` is centered by the browser's own
UA stylesheet via `margin: auto`, but Tailwind's preflight resets
`margin` to `0` on every element, silently overriding that. Fixed with
one global rule in `globals.css` (`dialog { margin: auto; }` — a type
selector outranks the preflight's `*` reset regardless of source
order), not a per-component fix, since the bug was never
component-specific.

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.
