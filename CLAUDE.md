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

**Auth is back on** (reversed Oct 2026 — see "Real auth + admin" below
for the full story; it was briefly off, Oct 2026, per "quita el tema de
la autenticacion por el momento"). Every page requires a real,
signed-in account; there's no self sign-up, only admin-sent invites.

- `athletes` — a dynamic roster (no longer fixed to `juan`/`jose`), rows
  created only through `/admin`'s invite flow. `auth_user_id` links a
  row to its real Supabase Auth user; `email`/`is_admin` were added in
  migration 013.
- `workouts`, `templates`, `strava_activities` (select) — RLS grants
  `authenticated` access (not `anon` — see migration 013). This is
  still a shared log among the trusted, invite-only roster, not a
  siloed multi-tenant app: any signed-in athlete can read/write any
  other athlete's workouts (the "Friends" picker in the header is a
  view filter, not a security boundary). The one real per-row boundary
  is `athletes` itself — an athlete can only update their own row (see
  migration 013's `athletes_update_own` policy), and `is_admin` can
  only ever be changed server-side regardless of whose row it is.
- `strava_connections` — real OAuth access/refresh tokens. RLS enabled
  with **no policies at all**, service-role only, same strictness
  pattern the Operations Hub codebase uses for every secret-holding
  table (`order_tracking_links`, `sa_reviews`, etc.). Never read or
  written from the browser — `src/app/api/strava/status/route.ts` is
  the only way the UI learns whether the signed-in athlete is
  connected, and it deliberately returns only
  `{connected, connectedAt, lastSyncedAt}`, never the tokens.

## Strava integration

- One Strava API app (`STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET`), but each
  athlete authorizes it **separately** — per explicit product decision,
  not a single shared Strava account. `src/lib/integrations/strava.ts`
  builds the authorize URL with `state` set to the athlete's own id (not a
  cookie — the Strava redirect is a fresh top-level navigation with no
  session context of its own), so `/api/strava/callback` knows which
  athlete just connected.
- Every Strava route (`connect`, `status`, `sync`, `disconnect`) derives
  the athlete from the **signed-in session** (`getSignedInAthlete()` in
  `src/lib/auth.ts`), not a client-supplied slug — `/settings` only ever
  shows your own Strava card, acting on "whoever is signed in." See
  "Real auth + admin" below for why/when this changed from the earlier,
  slug-based design.
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
2. **Run migrations 002-013 in order** (`supabase/migrations/`) if the
   project predates this file's current `schema.sql` — a fresh
   `schema.sql` run already includes all of them. **Auth is back on**
   (see "Real auth + admin" below) — José's account
   (`josemiguel.espi188@gmail.com`) already exists and is linked, and
   migration 013 seeds it as the first admin; every other athlete
   (Juan included) gets invited from `/admin` once this is deployed,
   no manual Auth-user creation needed. In **Supabase Dashboard ->
   Auth -> URL Configuration -> Redirect URLs**, add
   `https://<this app's domain>/accept-invite` — invite and
   password-reset emails both link there, and Supabase refuses to
   redirect anywhere not on this list.
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

### Planned vs Completed, RPE, and gear (Oct 2026)

Triggered by the user sharing a real TrainingPeaks activity-detail screen
as a reference and asking for the analysis to be "más completo." Three
concrete, honestly-derivable pieces got built from that reference; two
bigger pieces (below) were flagged rather than guessed at.

- **Planned vs Completed**: `ActivityDetailDialog.tsx` now looks up
  (`workouts` where `strava_activity_id = activity.id`) whenever it opens,
  and — when found — renders a small table mirroring TrainingPeaks'
  own Planned/Completed columns (duration, distance, RPE), plus the
  planned workout's own title/notes underneath. No new table or sync
  logic needed — this is just a read against data that already exists
  once auto-complete has linked a workout to an activity (see "Strava
  integration" above).
- **RPE** (Rating of Perceived Exertion, Borg CR10 scale 0-10 — the
  actual standard scale TrainingPeaks itself uses, not the separate
  5-face "how did you feel" scale also shown in the reference, which was
  deliberately skipped as redundant with RPE rather than building two
  parallel subjective scales). New `workouts.rpe` column (migration
  010), a slider in `WorkoutDialog.tsx` shown once a workout is marked
  done, surfaced in the Planned vs Completed table above.
- **Gear** (shoes/bike used): Strava's `GET /athlete` includes the
  athlete's own `shoes`/`bikes` lists; `/api/strava/sync` now fetches
  the profile **before** building activity rows specifically so each
  activity's `gear_id` can be resolved to a real name
  (`strava_activities.gear_name`, migration 010) at insert time rather
  than needing a second pass. Shown in `ActivityDetailDialog.tsx` when
  present.
- **Dialog width** bumped `480px -> 520px` to fit the new comparison
  table without cramping — the only layout change needed; everything
  else reuses the existing Stat grid pattern.

**Two bigger pieces from the same reference were explicitly NOT built,
flagged to the user instead of guessed at:**

1. **Fitness/Fatigue/Form (CTL/ATL/TSB)** — TrainingPeaks' own headline
   metric trio, a real, standard, computable formula (Banister
   impulse-response model: Fitness = 42-day EWMA of daily training
   stress, Fatigue = 7-day EWMA, Form = Fitness − Fatigue) that this
   codebase could legitimately compute from `relative_effort` history —
   **except** an accurate 42-day EWMA needs meaningfully more than 42
   days of real history to converge (ramping up from a cold start
   understates true fitness for weeks), which directly conflicts with
   the explicit "no necesito lo histórico, solamente el último mes"
   decision documented above. Not started until that tension is
   resolved one way or the other (extend history — even a lightweight
   daily-stress-only fetch further back, not full per-activity detail —
   or accept an understated/cold-start value for a while). **Resolved
   Oct 2026 — see "Fitness/Fatigue/Form (CTL/ATL/TSB), extended
   history" below**: history was extended (a separate lightweight
   90-day fetch), not skipped.
2. **The full "Analyze 360" view** (GPS route map, HR/cadence/pace
   graphs over time, time-in-zone distribution, laps) — needs Strava's
   `/activities/{id}/streams` endpoint (a new per-activity call, should
   be fetched lazily when an activity is actually opened, not during
   bulk sync, to avoid multiplying API calls against Strava's rate
   limits across 30 days of activities) plus a charting approach and,
   for the map specifically, a mapping library/tile provider (Leaflet +
   OpenStreetMap needs no account; Mapbox, what TrainingPeaks itself
   uses in the reference screenshot, needs one). The single largest
   remaining piece from "quiero tener todas las métricas de Strava" —
   needs its own go-ahead before starting, not a silent build.

## Fitness/Fatigue/Form (CTL/ATL/TSB), extended history (Oct 2026)

Resolves the first of the two items flagged as explicitly NOT built in
the "Planned vs Completed, RPE, and gear" section above — asked
directly ("¿quieres que extienda el historial?"), answered "extiende el
historial," so the 30-days-only decision was narrowed rather than
reversed.

- **A second, lightweight sync pass, separate from the existing 30-day
  detailed one.** `/api/strava/sync` already fetches the last 30 days
  of activities in full (gear, matching, AI description write-back —
  unchanged). It now also calls the same `fetchRecentStravaActivities()`
  a second time with `days=90` (`FITNESS_HISTORY_DAYS` in
  `app/api/strava/sync/route.ts`) purely to read each activity's own
  `suffer_score` (Relative Effort) — no other field, no per-activity
  detail stored. Those are summed per local day and upserted into a new
  `strava_daily_load` table (migration `012_training_load_history.sql`,
  mirrored in `schema.sql` — **needs this migration run in the Supabase
  SQL editor**), RLS-open-to-anon same as `strava_activities`, written
  only by the service-role sync route.
- **Why 90 days, not more or less**: the CTL EWMA has a 42-day time
  constant; 90 days gives it meaningful room to converge without
  fetching years of history nobody asked for. It's still not "fully"
  converged in the strict EWMA sense (that takes ~3x the time
  constant) — this is a deliberate, honest middle ground, not a claim
  of a perfect number.
- **`lib/fitnessForm.ts`**: `computeFitnessForm()` implements the
  Banister impulse-response model exactly as TrainingPeaks' own
  Fitness/Fatigue/Form popularized it — CTL = 42-day EWMA of daily
  stress, ATL = 7-day EWMA, TSB = yesterday's CTL − yesterday's ATL. A
  real, published formula (Banister), not reverse-engineered from any
  proprietary source. Zero-fills any rest day with no activity between
  the earliest and latest known date, so a sparse history still walks
  day by day correctly. Returns a `warmedUp` flag (true once there's a
  full 42 days of history) — **never hides the cold-start problem**:
  `components/FitnessPanel.tsx` shows an explicit "still warming up"
  note with the real day count whenever `warmedUp` is false, instead of
  presenting an understated number as if it were trustworthy.
- **`FitnessPanel.tsx`** (new, rendered in `DashboardPanel.tsx` right
  after `ZoneTables`, solo-athlete-only — same gating as every other
  Strava-derived panel there) reads `strava_daily_load` directly
  client-side and computes the model on the fly — no caching beyond the
  daily-load rows themselves, so it's always current as of the last
  sync. Shows the three current numbers plus a small 8-week line chart
  (CTL solid, ATL translucent in `--error`, TSB dashed in `--ink-3` —
  deliberately not using a sport accent color, since this isn't
  sport-specific) — labeled "estimated · from Relative Effort" in the
  header, consistent with how every other derived/computed number in
  this app (zones, race predictor) is labeled relative to a real one.
- This still doesn't attempt the full "Analyze 360" view (GPS map,
  streams, laps) — that's the second, separate item still flagged as
  not built in the section above, unaffected by this change.

## Default locale, default single-athlete view, Generate page, merged dashboard, athlete profile (Oct 2026)

A round of direct feedback after José tested the app solo, confusing two
default-UX habits ("ambos atletas por default") with real confusion
about who he was even looking at, plus a push toward the bigger
"triatleta profile" vision from the Roadmap section above.

- **App now defaults to English, not Spanish** — explicit, verbatim
  instruction: "ojo, siempre tiene que venir predeterminado en inglés."
  `LocaleProvider`'s initial state (`src/lib/i18n/context.tsx`) changed
  from `"es"` to `"en"`; still toggleable, and still remembers whatever
  a viewer picked via `localStorage` on their next visit — this only
  changes the very first, never-visited-before default.
- **The header's athlete switch no longer defaults to "Both"** —
  `AthleteViewProvider`'s initial `who`/`lastSingle`
  (then `src/lib/athlete-view-context.tsx`) changed from `"juan"`/
  showing both to `"jose"` alone. Direct quote: "no deberían salir los
  dos usuarios... genera mucha confusión." A real **"Friends" model**
  (pick whose data to see, not a hardcoded two-person roster) was what
  José asked for next — built later the same month once real auth came
  back; see "Real auth + admin" near the end of this file for the
  actual implementation (`lib/auth-context.tsx` replaced
  `athlete-view-context.tsx` entirely).
- **Dashboard is no longer a separate page.** `/dashboard` is deleted;
  its entire content (KPIs, weekly volume chart, by-sport breakdown,
  upcoming list, zone tables, Strava totals, best efforts, recent
  activities) was extracted into `components/DashboardPanel.tsx` and
  now renders at the bottom of `/calendar`, below the week/month grid —
  direct quote: "el panel me gustaría que esté debajo del
  calendario... meterlo en la misma hoja del calendario." `SiteHeader`'s
  nav lost its `nav_dashboard` entry. The Calendar page's own
  `activities` state had to stop being pre-filtered to "unlinked only"
  at fetch time (that filtering now happens in a separate
  `visibleActivities` memo used only by the week/month chips) so
  `DashboardPanel` can still see every last-30-days activity, linked or
  not, for its Recent Activities/Best Efforts/Strava Totals — the panel
  re-filters by the selected athlete internally the same way the old
  `/dashboard` page did.
- **Recent Activities is now paginated, 5 per page**, with Prev/Next —
  direct quote: "debería salir solamente las últimas cinco actividades
  recientes y de ahí una cosa para poder... poner siguiente página." No
  new query: pagination is a client-side slice over whatever's already
  in `DashboardPanel`'s `visibleActivities` (the same last-30-days set
  the rest of the panel uses), `RECENT_PAGE_SIZE = 5`.
- **Templates renamed to "Generate"** (`src/app/templates/page.tsx`,
  still at the `/templates` route — only the label/heading changed, not
  the URL) — direct quote: "el plantillas debería ser Generate. no me
  gusta cómo se llama plantillas." Per the same "siempre predeterminado
  en inglés" instruction immediately following that request, "Generate"
  is treated as the section's actual name rather than a word to
  translate — both the `es` and `en` entries of `nav_templates`/`tpl_h`
  in `i18n/context.tsx` are literally "Generate" (see the comment there).
  The page now has three stacked sections: an AI chat placeholder, the
  weekly-plan Excel importer (moved here from Calendar, see below), and
  the original workout-preset grid under a new "Base workouts" heading.
- **The weekly-plan Excel import panel moved from Calendar to
  Generate** — direct quote: "ese Excel debe estar en la sección de
  plantillas para poder cargar los entrenamientos." `PlanImportPanel`
  itself needed no logic change, just a restyle from a thin inline bar
  to a full `Card` (matching the new chat card next to it) — its
  `onImported` callback is now a no-op, since Generate has no workout
  list of its own to refresh; Calendar already re-fetches fresh on
  every mount, so a newly imported week shows up the next time it's
  opened.
- **`components/AiChatPlaceholder.tsx`** — a real, usable chat UI (type,
  send, see your message appear) with **no model behind it at all** —
  direct quote: "ahorita pones solamente un chatbot... y no le
  conectamos todavía con Anthropic, pero la idea sería poder como
  chatear." No API call is made on send; the only "response" is one
  static greeting bubble shown once up front, explicitly saying it
  isn't connected yet. This is intentionally honest, not a stand-in
  that pretends to be smarter than it is (same rule this file applies
  to every other feature) — it's the eventual home of the Roadmap's
  "virtual coach agent" item, once that's actually built.
- **Comprehensive athlete profile** (`components/AthleteProfileCard.tsx`,
  new, rendered above the existing Training Zones card on `/settings`) —
  direct quotes: "tiene que verse así de completo como el perfil de un
  triatleta: zonas, VO2 max, todo... mejores tiempos... sería bueno
  también en settings... hacer un cuestionario... súper completo." New
  columns on `athletes` (migration `011_athlete_profile.sql`, mirrored
  into `schema.sql` — **needs this migration run in the Supabase SQL
  editor**): `birth_date`, `sex`, `height_cm`, `weight_kg` (manual,
  distinct from the Strava-auto-pulled `strava_weight_kg`),
  `resting_hr`, `max_hr`, `goal_race_name`, `goal_race_date`,
  `goal_distance`, `goal_notes`, and `personal_bests` (jsonb array of
  `{id, sport, distanceLabel, distanceMeters, timeSec, date, raceName}`).
  The card is one combined questionnaire (personal info, goal race,
  resting/max HR, an add/remove personal-bests list with sport +
  preset-distance pickers in `lib/racePredictor.ts`'s
  `DISTANCE_PRESETS`) saved with a single Save button, same pattern the
  Operations Hub codebase uses elsewhere for a multi-section form.
  **Race predictor**: `lib/racePredictor.ts`'s `predictRaceTimes()`
  projects 5K/10K/Half/Marathon times from the single longest known
  *run* personal best using Riegel's formula (`T2 = T1*(D2/D1)^1.06`) —
  a real, published formula (Peter Riegel), not invented or
  reverse-engineered from any proprietary source. Deliberately a
  single-reference model, always labeled "estimated" in the UI (vs.
  "actual" when a standard distance has a real PB within 2%) — a true
  VDOT-style calculator would weight multiple recent results, which
  this app doesn't attempt. This profile data is explicitly **prep
  work for the still-undone Roadmap items** (AI-generated plans, a
  virtual coach agent, an Excel export carrying the full triathlete
  profile for an AI agent to read) — direct quote: "la idea es que tú
  en el Excel pases toda la información del triatleta para que...
  cargues en un agente de cloud [y] los entrenamientos que haga, haga
  en función a toda esta información." None of that consumption side is
  built yet; this phase only adds the data entry layer it will read
  from.
- **`/settings` now shows only the athlete(s) currently selected in the
  header switch**, not always both — direct quote: "en settings,
  obviamente solo tiene que salir mis Training Zones... deberíamos
  estar ahorita en una cuenta general." `SettingsContent` now reads
  `useAthleteView()`'s `who` and renders profile/zones/Strava cards only
  for that slug (or both, if "Both" is explicitly selected in the
  header) instead of unconditionally mapping over every `ATHLETES` key.
- The user explicitly offered to share a real photo of his actual zone
  data for José to be entered directly — **no specific numeric values
  (LTHR, HR zones, personal bests, etc.) were fabricated or assumed
  from any reference screenshot** shown during this phase; every new
  field here is a blank input the athlete fills in themselves.

## Simple activity map, zones in the profile card, full athlete profile in the Weekly Plan Excel (Oct 2026)

Three more direct requests from the same conversation, built together.

- **Activity route map, the cheap version** (direct quote: "mapa simple
  con el polyline que ya tenemos guardado"). Confirmed by reading the
  actual sync code: `/api/strava/sync` already stores each activity's
  full raw object verbatim (`raw: a`), and Strava's activity-list
  endpoint (what that sync call already uses) includes a
  `map.summary_polyline` on every activity — so a simplified route was
  already sitting unused in `strava_activities.raw` for every synced
  activity, no new Strava call needed. `StravaActivity.raw` (previously
  undeclared on the TS type, even though the DB column always existed)
  now exposes `map.summary_polyline`. `lib/polyline.ts` decodes Google's
  standard encoded-polyline format (a small, published algorithm, not
  Strava-specific). `components/ActivityMap.tsx` draws it with Leaflet +
  OpenStreetMap tiles (no account needed, unlike Mapbox) — `leaflet`
  dynamically imported inside a `useEffect` specifically because it
  touches `window`/`document` at init time, which would otherwise throw
  during Next's server-side pre-render of this "use client" component.
  Rendered in `ActivityDetailDialog.tsx`, between the stat grid and the
  Planned vs Completed table; renders nothing when an activity has no
  polyline. This is deliberately NOT the full "Analyze 360" view (high-
  res streams, graphs, laps) still flagged as not built above — just the
  cheap win available from data already on hand.
- **Zone tables inside the Settings profile card too** (direct quote:
  "sería bueno que salga las zonas cardíacas, tanto por pace como por
  heart rate, también ahí en perfil"). `AthleteProfileCard.tsx` now also
  renders `<ZoneTables athlete={athlete} />` (read-only, same component
  `/dashboard`'s panel and the dedicated Training Zones card already
  use) right after the Resting/Max HR section — sourced from the same
  `athlete` row already loaded in that component's own state, no extra
  fetch. The actual threshold numbers (LTHR/pace/FTP) are still only
  editable from the separate Training Zones card below it, which this
  new block explicitly says in its own caption, to avoid implying
  there's a second, different set of thresholds.
- **The Weekly Plan Excel now carries the full athlete profile for both
  athletes, not just the week's workouts** (direct quotes: "tiene que
  el template tener toda la información... para que una vez que se
  mande a la gente de Cloud, este pueda analizar al atleta" / "tiene
  que estar ahí en el Weekly Plan Excel"). `GET /api/plan/template` now
  reads every `athletes` row server-side (service-role, same pattern as
  every other server-side Supabase read in this codebase) and passes it
  into `buildPlanTemplate()`, which gained three more sheets when
  profile data is present: **Athlete Profile** (one row per athlete —
  personal info, goal race, resting/max HR, LTHR/pace/FTP/VO2max, and
  the race predictor's 5K/10K/Half/Marathon estimates, each labeled
  "(actual)" when it's a real PB rather than a Riegel projection),
  **Personal Bests** (one row per PB entry), and **Training Zones** (one
  row per HR/pace/power zone, computed with the same `lib/zones.ts`
  functions `/settings` already uses — skipped per zone-system when that
  threshold isn't set, never a guessed range). All three reuse the
  existing pure `lib/racePredictor.ts` / `lib/zones.ts` functions
  unmodified — no new computation logic, just new sheets presenting data
  that already exists elsewhere in the app. Verified with an actual
  round-trip test (generate with fake multi-athlete data, re-parse with
  `exceljs`, confirm every sheet/row/value) before shipping, same
  discipline as the original Excel import's own row-ordering bug catch.
  `parsePlanWorkbook()` (the import side) only ever reads
  `wb.worksheets[0]` ("Plan"), so these extra sheets can't interfere
  with importing workouts back in. One combined file was chosen over a
  separate per-athlete export, since the Weekly Plan Excel already spans
  both athletes via its own Athlete column, and the user's own wording
  left either shape open ("puede ser otro Excel aparte, pero tiene que
  estar ahí") — bundling it into the same download avoids managing two
  files staying in sync with each other.

## COROS / Garmin structured-workout push — researched, not built (Oct 2026)

Asked directly to investigate feasibility/complexity of pushing
structured workouts (with real intervals) to COROS and/or Garmin, and
report back — **explicitly research, not a build request**, so nothing
below is implemented yet. This sandbox's egress proxy blocks both
`dropbox.com` (the COROS API Reference Guide the user linked) and
`docs.tryterra.co`, so the findings below come from `WebSearch` results
only, not a direct read of either platform's real documentation — flagged
accordingly, and **should be re-verified against the real docs once
COROS responds to the application already submitted** (see the "COROS
API Application" work elsewhere in this conversation's history).

- **COROS does have an official structured-workout push endpoint**
  (`tp/list/push`, plus `tp/workout/deleteById`) as part of its gated
  **Partner API** — access requires being an established/registered
  company and agreeing to their API Terms, applied for via
  `api@coros.com` (the same application the user already submitted
  covers exactly this — "Structured Workouts and Training Plans Sync"
  was one of its checkboxes). A forum mention (unconfirmed firsthand)
  says pushed plans are limited to **7 days at a time**, and a
  third-party sync tool notes COROS **does not support nested repeat
  blocks** — an interval set (e.g. 6x400m) has to be sent as flattened
  individual steps, not a single "repeat 6 times" block.
- **COROS also has a lighter, self-service path**: "Build on COROS"
  with OAuth 2.0, no partner application needed — good for smaller
  projects per COROS's own framing, which fits Cadencia (2 users) far
  better than the Partner API's "established company" bar. **Not
  confirmed from here whether this self-service tier includes
  structured-workout push or just read access** (activity/health data)
  — worth asking directly once in touch with COROS, since it could make
  the whole Partner-API application unnecessary.
- **Garmin requires a completely separate application** — its own
  Developer Program / Training API, gated independently of COROS, with
  no publicly confirmed JSON schema outside approved partners (every
  schema found via search was reverse-engineered by third parties, not
  official). Two separate approval processes, not one.
- **A third-party aggregator (Terra, tryterra.co) can push to both
  Garmin AND COROS through one unified API**, without separate partner
  approval for either — its "Planned Workouts API" (labeled
  **pre-release**) models a workout as `step_blocks` → `steps`, each
  with an `intensity_type` (warmup/interval/recovery/cooldown) and a
  `completion_condition` (time/distance/calories/reps/open), targets
  given as absolute values (pace/HR/power/cadence/RPE) or relative to
  the athlete's own FTP/threshold HR/max HR/threshold pace — closest
  thing found to a real, concrete, portable interval-workout model.
  Caveats found alongside it: **Garmin only accepts a specific target-
  type set** (an unsupported target gets rejected, surfaced as a warning
  rather than a hard failure), it's a **paid add-on** to a Terra
  subscription (no pricing figure found), and it's pre-release — worth
  checking current status/pricing directly before counting on it, not
  assuming the search summary above is still accurate.
- **There is no single portable "file" to hand either platform for a
  live automatic push** — unlike the `.ics` calendar export this app
  already builds, a structured-workout push is a JSON API call (one of
  the schemas above), not a downloadable file the athlete imports by
  hand. A file-based route (e.g. a FIT workout file manually imported
  into the COROS/Garmin app) wasn't confirmed as actually supported by
  either platform's regular consumer app from the search results
  gathered — not asserted here either way.
- **The actual biggest gap found isn't COROS or Garmin at all — it's
  Cadencia's own data model.** `workouts.notes`/`workout_type` are
  plain free text; there is no structured representation anywhere in
  this schema of "6x400m @ 5K pace, 90s recovery between reps, 10min
  warmup/cooldown" as actual steps/targets/repeats. Every platform
  above (COROS's `tp/list/push`, Garmin's Training API, Terra's
  `step_blocks`) needs that structure as input — so even once a partner
  approval comes through, there's nothing to push yet without first
  building a structured-workout editor in Cadencia itself. That's
  realistically the larger piece of this whole feature, independent of
  which platform(s) end up being the destination, and isn't gated by
  anyone's approval — it could start now if wanted, before COROS/Garmin
  access exists at all.

## Real auth + admin + "Friends" (Oct 2026)

The biggest structural change in this codebase so far — auth comes back
on (reversing the "Data model & auth" decision above), every page now
requires a real account, and the hardcoded Juan/José pair becomes a
dynamic, admin-managed roster. Direct quotes driving this: "necesitamos
una parte, un botón de admin... donde manejar los usuarios. En los
usuarios básicamente puedes añadir usuarios... una vez añadido el
usuario se manda una invitación a través de mail... al lado del título
de cadencia no me gusta que esté como Juan José Miguel Both, sino...
José Miguel Friends." Two mechanism decisions were confirmed explicitly
(`AskUserQuestion`) before touching anything, given how costly either
would have been to guess wrong: **Friends is open, no request/accept**
(being invited by an admin at all is the trust boundary — "Automático,
sin solicitud"), and **yes, re-enable full-app login now**, accepting
that every page behind it.

- **Migration `013_real_auth_and_admin.sql`** (mirrored in
  `schema.sql` — **needs this migration run in the Supabase SQL
  editor**): `athletes` gains `email` and `is_admin`; the old
  `slug in ('juan','jose')` check constraint is dropped (the roster is
  no longer fixed); a `athletes_guard_is_admin` trigger silently
  reverts any attempt to change `is_admin` from a non-service-role
  write path, so a motivated user calling the REST API directly can't
  self-promote — `is_admin` only ever changes through `/admin`'s
  service-role API routes. José is seeded as the first admin (his
  account/row already existed from an earlier, since-reversed auth
  attempt). **RLS flips from `anon, authenticated` back to
  `authenticated` only** on `athletes`/`workouts`/`templates`/
  `strava_activities`/`strava_daily_load` — real accounts exist again,
  so there's no reason for a visitor with no account to read or write
  anything. This is NOT a privacy boundary between signed-in athletes
  though: any authenticated athlete can still read/write any other
  athlete's `workouts` (unchanged "shared coach log" behavior) — the
  one real per-row boundary is `athletes` itself, where a new
  `athletes_update_own` policy (`auth_user_id = auth.uid()`) means an
  athlete can only ever update their own profile row, never anyone
  else's, and never `is_admin` on any row (the trigger covers that
  even for your own row).
- **`lib/auth-context.tsx`** (renamed from the old
  `athlete-view-context.tsx`, which it replaces entirely) is now both
  the auth gate AND the view-filter state in one `AuthProvider`/
  `useAuth()`: tracks the Supabase session, resolves `me` (your own
  `athletes` row, matched by `auth_user_id`) and `athletes` (the full
  roster, for the Friends picker and any slug -> name/initials lookup
  — this directly replaces the old hardcoded `ATHLETES` constant,
  which is gone from `lib/types.ts`; `AthleteSlug` itself is still
  exported but is now just an alias for `string`, not a two-value
  union, so most existing `AthleteSlug`-typed call sites needed no
  rename), and `viewing` (slugs currently shown on the calendar —
  always includes your own, `toggleFriend()` adds/removes others,
  replacing the old `who: "juan" | "jose" | "both"`). **No gate
  component separate from the provider** — `AuthProvider` itself
  renders either the sign-in screen or `children`, based on session
  state, which avoids a second wrapper layer; the one pathname
  exception is `/accept-invite` (checked by prefix inside the
  provider — a route-group split would have been architecturally
  cleaner but meant moving every existing page into a new folder, not
  worth it for one exception).
- **Sign-in screen** (inside `auth-context.tsx`, shown by
  `AuthProvider` whenever there's no session) is plain email+password,
  **no self sign-up** (every account comes from `/admin`'s invite
  flow), plus "Forgot your password?" (`supabase.auth
  .resetPasswordForEmail`, same `/accept-invite` redirect as a fresh
  invite — one page serves both since the underlying Supabase
  mechanism, a URL-hash session, is identical either way).
- **`src/proxy.ts`** (Next.js 16 renamed the old `middleware.ts`
  convention to `proxy.ts`/`export function proxy` — built directly
  against that, not the deprecated name) does the standard Supabase
  SSR session-cookie refresh on every request. It doesn't gate
  anything itself — `AuthProvider` does that client-side.
- **`lib/auth.ts`** (server-side): `getSignedInAthlete()` reads the
  real session now, replacing the old `getAthleteBySlug()` (deleted —
  nothing calls it anymore). `requireAdmin()` throws unless the
  signed-in athlete's `is_admin` is true; every `/api/admin/*` route
  calls it first.
- **Strava routes (`connect`/`status`/`sync`/`disconnect`) derive the
  athlete from the session now, not a client-supplied `?athlete=`
  slug** — closes the exact gap flagged in the old "Strava integration"
  note above ("nothing stops Juan from clicking Connect on José's
  card"). `/settings` correspondingly dropped its per-athlete-card
  loop entirely — it only ever shows `useAuth().me`'s own Profile/
  Zones/Strava cards now, never another athlete's.
- **Header redesign** (`SiteHeader.tsx`): the old "Juan / José / Both"
  pill switcher is gone, replaced with a pill showing your own name
  plus a "Friends ▾" dropdown (checkboxes, one per other athlete in
  the roster) that adds/removes them from `viewing` — multiple friends
  can be checked at once, generalizing the old binary "Both". An
  "Admin" link renders **only for `me.is_admin`, as the rightmost nav
  item** (per explicit instruction, "lo más a la derecha posible"), and
  a Sign Out button was added (there wasn't one before, since auth was
  off).
- **`/admin`** (`app/admin/page.tsx` + `app/api/admin/athletes/*`):
  lists the roster (name, email, admin badge, has-an-account or not),
  with two invite paths from one endpoint
  (`POST /api/admin/athletes/invite`, `supabase.auth.admin
  .inviteUserByEmail()` — same proven pattern as the Operations Hub
  codebase's own "Team invites" feature, not a hand-rolled token
  table): **"+ Add athlete"** creates a brand-new `athletes` row
  (slug auto-generated from the name, deduped against the roster) and
  invites it in one call; **"Send invite" on an existing unlinked
  row** (Juan's, seeded with no `auth_user_id` before real auth came
  back) instead links the new auth account to that SAME row —
  preserving its existing workouts/Strava connection instead of
  creating a duplicate "Juan 2". `PATCH /api/admin/athletes/[id]`
  toggles `is_admin`, refusing to demote the last remaining admin
  (would lock everyone out of `/admin` with no way back short of a
  manual SQL edit).
- **`/accept-invite`** (public, outside the auth gate) is where both
  an invite link and a password-reset link land — Supabase's browser
  client auto-detects the session from the URL hash
  (`detectSessionInUrl`, on by default), this page waits for it, then
  `supabase.auth.updateUser({password})` finishes the account and
  routes to `/settings` — directly satisfying "como tienes que
  obviamente crear tu clave y llenar el form de toda la info de
  settings": password first, then straight into the profile
  questionnaire that already existed.
- **A "Connect COROS / Garmin" placeholder card** sits next to the
  Strava card on `/settings` (direct quote: "en el introform tiene que
  conectar con strava y con coros o garmin, ahorita no esta lista esa
  conexion") — disabled, labeled "Not available yet," pointing at this
  file's own COROS/Garmin research section rather than faking a
  working connection, same honesty rule this codebase applies to every
  other not-yet-built integration (the AI chat placeholder, etc.).
- **Every file that touched the old hardcoded `ATHLETES`/`Who`/
  `useAthleteView`** was updated to the dynamic roster:
  `WorkoutDialog.tsx`'s athlete picker now takes an `athletes` prop;
  `lib/ics.ts`'s `buildWeekIcs()` takes `athleteBySlug` +
  `isMultiple` instead of `who`; `lib/excelPlan.ts`'s `matchAthlete()`
  and the Plan sheet's dropdown take the real roster instead of the
  constant (both `buildPlanTemplate()` and `parsePlanWorkbook()` now
  require it as a parameter — `GET /api/plan/template` and
  `POST /api/plan/import` fetch it server-side); `DashboardPanel.tsx`
  and `calendar/page.tsx` filter by `viewing.includes(athleteSlug)`
  instead of `who === "both"`.
- Not yet tested against a real Supabase project from this sandbox (no
  live project connected here, same standing limitation as every other
  Supabase-dependent feature in this codebase) — **confirm once
  deployed**: that migration 013 runs cleanly, that the
  `/accept-invite` redirect URL is allow-listed in the Supabase
  dashboard, that inviting Juan from `/admin` actually links his
  existing row (not a duplicate), that the last-admin-removal guard
  actually blocks itself out, and that signing out and back in behaves
  correctly across a real browser session (not just this sandbox's
  build-time type checking).

### Two live-testing bugs, found and fixed the same day

1. **Wrong redirect domain** — the reset-password email sent the user
   to `localhost:3000` instead of the real deployed domain. Root cause
   was **Supabase's own "Site URL" field** (Auth -> URL Configuration),
   separate from the "Redirect URLs" allow-list this file already told
   people to set — Site URL defaults to `http://localhost:3000` on a
   fresh project and is the fallback used whenever the requested
   `redirectTo` doesn't exactly match an allow-listed entry. Fixed by
   setting Site URL to the real deployed domain too, and adding the
   exact `https://<domain>/accept-invite` path (not just the bare
   domain) to Redirect URLs — a domain-only entry there does NOT match
   a request for a specific path.
2. **"This link is invalid or expired" even on a correct, fresh link**
   — root cause: `createClient()` uses `@supabase/ssr`'s
   `createBrowserClient`, which defaults to the **PKCE** flow. PKCE
   stores a code verifier in the browser that *requested* the
   reset/invite, and the emailed link only works if opened back in
   that same browser — which an email link essentially never is
   (different tab, different device, a mail app's in-app browser,
   etc.). This is a well-documented Supabase gotcha, not specific to
   this codebase. **Fixed by switching to the `token_hash`+`verifyOtp`
   pattern Supabase's own docs recommend for exactly this case** — see
   the big comment at the top of `app/accept-invite/page.tsx`.
   **This needs a matching change in the Supabase dashboard, or it
   still won't work**: under **Auth -> Email Templates**, both "Invite
   user" and "Reset Password" need their link changed from the default
   `{{ .ConfirmationURL }}` to
   `{{ .SiteURL }}/accept-invite?token_hash={{ .TokenHash }}&type=invite`
   (invite template) and `&type=recovery` (reset template) respectively
   — **not yet confirmed this was actually done in the dashboard**, do
   that before testing again. The old `?code=...` PKCE path was left in
   the page as a fallback (harmless, just unused once the templates are
   switched), not ripped out.

## COROS structured-workout push (prep work, Oct 2026)

Built per explicit instruction, ahead of COROS's response to the Partner
API application (see the "COROS / Garmin structured-workout push —
researched, not built" section above for the research this follows up
on) — specifically to prepare the two things promised in that
application's email: the OAuth redirect URI actually existing, and real
(if still unconfirmed) Cadencia-side capability to sync structured
workouts. **Everything COROS-API-specific here is unconfirmed** — this
sandbox never reached COROS's real docs (Dropbox blocked). Read
`lib/integrations/coros.ts`'s file header before touching any of this;
it says the same thing in more detail.

- **`coros_connections` table** (migration
  `014_coros_structured_workouts.sql`, mirrored in `schema.sql` —
  **needs this migration run in the Supabase SQL editor**) — exact
  mirror of `strava_connections`: real OAuth tokens, RLS enabled with
  no policies at all, service-role only.
- **`workouts.workout_steps`** (same migration): the structured-
  workout data model this whole feature was missing, per the earlier
  research's own conclusion ("the actual biggest gap... isn't COROS or
  Garmin at all — it's Cadencia's own data model"). `WorkoutStep`
  (`lib/types.ts`): `{id, kind: warmup|work|recovery|cooldown|rest,
  durationType: time|distance|open, durationValue, targetType:
  pace|hr|power|cadence|open, targetLow, targetHigh, repeatCount}` —
  deliberately flat with at most ONE level of repeat grouping (no
  nested repeat-of-repeats), matching COROS's own documented
  constraint from the earlier research ("does not support nested
  repeat blocks"). A minimal add/remove step-row editor was added to
  `WorkoutDialog.tsx` (reusing the Personal Bests list-editor pattern
  from `AthleteProfileCard.tsx` for visual consistency) — functional,
  not a fancy drag/drop builder; this is genuinely useful on its own
  (a real interval structure attached to a workout) independent of
  whether COROS ever actually receives it.
- **`lib/integrations/coros.ts`**: OAuth URL building + token exchange/
  refresh follow standard OAuth2 (RFC 6749) conventions — safe to trust
  as code, same shape as the already-working Strava integration. **But
  the actual base URLs are env vars with NO hardcoded default**
  (`COROS_AUTHORIZE_URL`, `COROS_TOKEN_URL`, `COROS_API_BASE`,
  alongside `COROS_CLIENT_ID`/`COROS_CLIENT_SECRET`) — guessing COROS's
  real domain would have silently pointed at a wrong URL; leaving it
  unset instead throws a clear "not configured" error, same maturation
  path `STRAVA_CLIENT_ID` went through before it was set. The token
  response's `expires_in` (seconds-from-now) is assumed rather than
  Strava's absolute `expires_at` — the more common OAuth2 convention,
  but still unconfirmed for COROS specifically.
- **`pushStructuredWorkoutToCoros()`**: the actual push call target
  (`POST {API_BASE}/tp/list/push`) and request body shape are the
  least-confirmed part of this whole feature — `tp/list/push` is only
  a third-party forum mention, not official docs, and the body's field
  names (`step_name`, `duration_s`, `power_low_w`, `power_high_w`,
  `sets`) come from the unofficial `rCoros` R package's own reverse-
  engineering of COROS's internal data, already noted (not newly
  found) in the earlier research section. **Do not treat this as
  working code** — it exists so `POST /api/coros/push` and the
  "Push to COROS" button in `WorkoutDialog.tsx` (shown once a workout
  has at least one structured step) have a stable interface to call
  today; the function body needs a real rewrite once the Partner API
  Reference Guide is actually read.
- **OAuth routes mirror Strava's exactly**: `/api/coros/connect`,
  `/api/coros/callback` (this is literally the URL given to COROS as
  the Redirect URI — it now really exists and accepts the redirect,
  it just can't complete the token exchange until the env vars above
  are real), `/api/coros/status`, `/api/coros/disconnect`. No
  `/api/coros/sync` — COROS only has a push capability planned here
  (per-workout, from the workout dialog), not a Strava-style pull/sync
  of COROS's own data.
- **`/settings`'s "Connect COROS/Garmin" card is no longer a disabled
  placeholder** — it's a real Connect/Disconnect card now (mirroring
  the Strava card), with an explicit note that COROS's API is still
  pending approval and connecting may not work yet. This replaces,
  rather than coexists with, the earlier honest-placeholder version.
- **`POST /api/coros/push`** deliberately lets any signed-in athlete
  push any workout (not scoped to "my own COROS connection" the way
  Strava connect/sync is) — matches the existing "shared coach log"
  openness `workouts` already has (any signed-in athlete can edit/
  delete any other athlete's workout), since the workout being pushed
  may belong to a teammate being coached, not necessarily the person
  clicking the button.
- Not tested against anything real — there is no real COROS account,
  API access, or even confirmed documentation to test against from
  this sandbox. **Before relying on any of this**: get the real
  Partner API Reference Guide (from a machine that can reach Dropbox,
  per the earlier research section's own note), confirm the OAuth
  endpoints and `tp/list/push` payload shape against it, update
  `lib/integrations/coros.ts` accordingly, then set the real
  `COROS_*` env vars on Vercel.

## Garmin Personal API (read-only, per-athlete, Oct 2026)

A real, working piece of Garmin integration — **deliberately not** the
OAuth/push model built for COROS. The user pasted a real Garmin
"Personal API Token" (from
`connect.garmin.com/app/settings/personalApiToken`) directly into chat
asking for a shared place to store COROS + Garmin keys so the platform
could connect "internally" to any athlete's account. Investigated first
rather than building blind: Garmin's own developer docs (found via
search; `developer.garmin.com` is blocked from this sandbox, same as
COROS's Dropbox) say the Personal API is **"meant for individual Garmin
users... not intended for commercial applications serving multiple end
users"** and is **explicitly read-only, pull-only** — it cannot push
workouts (that needs Garmin's paid Starter/Enterprise Training API, a
formal business application like COROS's). Flagged both of these to the
user (plus that the pasted key was now exposed and should be rotated)
before building anything; confirmed via `AskUserQuestion` to build the
one thing this API tier is actually meant for: each athlete connecting
their own key, for their own data, not something Cadencia uses on an
athlete's behalf.

- **`garmin_connections` table** (migration
  `015_garmin_personal_api.sql`, mirrored in `schema.sql` — **needs
  this migration run in the Supabase SQL editor**) — intentionally a
  different shape from `strava_connections`/`coros_connections`: no
  `refresh_token` (Garmin's FAQ: "Garmin does not issue refresh
  tokens"), just the long-lived `personal_api_key` the athlete pastes
  in, plus a cached `access_token`/`access_token_expires_at` re-derived
  from it on demand. Same RLS strictness as the other two (service-role
  only, no policies).
- **`lib/integrations/garmin.ts`**: the token-exchange endpoint
  (`POST https://personal.connectapi.garmin.com/personalapitoken-
  service/personal-api/personal-api-key/token`, `Authorization: ApiKey
  <key>` header) was found via web search of Garmin's own FAQ page
  content plus a community MCP server using the identical pattern —
  meaningfully more confirmed than anything found for COROS, but still
  not read directly from Garmin's own docs. The response's token field
  name (`access_token`) is read defensively (a few likely variants
  tried) since no raw sample response was ever found. **No data-
  fetching function exists** (e.g. "list my activities") — every
  source describes those as private, undocumented endpoints that can
  change without notice, and none could be found with any confidence.
  Saving a key calls this exchange live first, so an invalid/typo'd key
  is rejected immediately instead of stored blind.
- **`/api/garmin/{connect,status,disconnect}`** — no `/callback`
  (there's no OAuth redirect here, it's a plain form POST) and no
  `/push` (read-only). `connect` is scoped to the **signed-in
  athlete's own key only** — unlike `/api/coros/push`, which
  deliberately lets any athlete act on any workout, this never accepts
  another athlete's id, matching Garmin's own "your key, your data"
  framing.
- **`/settings`'s Garmin card** includes an inline, numbered guide
  (go to the Personal API Token page, generate, copy immediately since
  Garmin shows it only once, paste below) — the one onboarding guide
  the user explicitly asked for, built directly into the card rather
  than a separate page since the whole flow is short.
- **Still nothing actually pulls or displays Garmin activity data** —
  only the key storage + live validation is real. Building a sync/
  display feature on top of this needs the real data-endpoint path
  confirmed first (same standing caveat as COROS's push payload).

## Google sign-in, open self-registration (Oct 2026)

Direct, urgent request: "la plataforma tiene que tener un sistema de
autenticacion con google... que puedes crear una cuenta para entrar a
la plataforma." This is a real reversal of the invite-only model the
"Real auth + admin" section above deliberately built ("no self
sign-up, only admin-sent invites"), so it was confirmed explicitly via
`AskUserQuestion` before touching anything, given how costly guessing
wrong would be here (open signup to a shared training log vs. a
Google button that still requires an admin invite first are very
different security postures). The user chose **"Auto-registro
abierto"**: anyone with a Google account can sign in and a brand-new
`athletes` row is created for them automatically, no invite and no
approval step, and they immediately see the same shared training log
every other athlete does (same "open to any signed-in athlete"
model `workouts`/`templates` already have, per "Data model & auth"
above).

- **This does NOT replace email/password sign-in** — an
  already-invited athlete can still sign in with the password an
  admin's invite set up. Google is an *additional*, self-serve path
  layered on top, not a swap.
- **`src/app/auth/callback/route.ts`** (new) is where Supabase sends
  the browser back after Google's consent screen. The actual flow:
  `supabase.auth.signInWithOAuth({provider: "google"})` (in the new
  `handleGoogleSignIn()` inside `SignInScreen`,
  `src/lib/auth-context.tsx`) redirects to Google using a redirect URI
  that's **Supabase's own hosted callback**
  (`https://<project-ref>.supabase.co/auth/v1/callback`), not this
  app's domain — Google redirects there first, Supabase does the
  token exchange with Google, then forwards the browser to this app's
  own `redirectTo` (`/auth/callback`) with a `?code=...` PKCE code this
  route exchanges for a real session cookie via
  `exchangeCodeForSession()`. Same two-hop shape Supabase's own OAuth
  docs describe, not a custom invention.
- **`src/lib/ensureAthlete.ts`**: right after that exchange succeeds,
  `ensureAthleteForUser()` runs with the service-role client (bypasses
  RLS, same as the admin invite route) and checks whether an
  `athletes` row already exists for this `auth_user_id` OR `email`. If
  one does (a returning Google sign-in, or an email Supabase
  auto-linked to an existing admin-invited password account because
  the email matched and was verified), it's a no-op. If not, it
  inserts a brand-new row: `name` from the Google profile
  (`user_metadata.full_name`/`name`, falling back to the email's local
  part), a `slug` generated and deduped against the current roster,
  `is_admin: false`. **`slugify`/`initialsFrom`/`dedupeSlug`** were
  extracted from the admin invite route into a new shared
  `src/lib/athleteSlug.ts` so both paths generate a new athlete's
  slug/initials identically rather than duplicating that logic.
- **The sign-in screen** (`SignInScreen` in `auth-context.tsx`) now
  leads with a "Continue with Google" button (inline multi-color G
  logo SVG, no external image/icon font) above a divider, with the
  existing email/password form and "Forgot your password?" flow
  unchanged below it. The old "No self sign-up. Ask an admin to invite
  you." footer line, no longer accurate, was replaced with "New here?
  Sign in with Google and your account is created automatically." A
  failed OAuth attempt redirects back to
  `/calendar?auth_error=1` (the callback route's own failure path,
  since there's no dedicated "sign-in failed" page to land on) and
  `SignInScreen` reads that query param once on mount to show an error
  message, then strips it from the URL.
- **Two manual setup steps in dashboards this app has no API for**
  (same "this app can't create the credential itself" pattern as every
  other OAuth integration here):
  1. **Google Cloud Console**: create an OAuth 2.0 Client ID (OAuth
     consent screen + Web application credentials). Its one
     "Authorized redirect URI" is the Supabase one above
     (`https://<project-ref>.supabase.co/auth/v1/callback` — copy the
     exact value Supabase's own Google provider page shows, not a
     guess), **not** `/auth/callback` on this app's domain.
  2. **Supabase Dashboard -> Authentication -> Providers -> Google**:
     toggle it on, paste the Client ID/Secret from step 1. Then
     **Authentication -> URL Configuration -> Redirect URLs**: add
     `https://<this app's domain>/auth/callback` to the allow-list
     (same list that already has `/accept-invite`) — Supabase refuses
     to forward the browser anywhere not on it.
- Not yet tested against a real Google OAuth client or Supabase
  provider config from this sandbox (no live Supabase project
  connected here, same standing limitation as every other
  Supabase-dependent feature) — confirm once both manual steps above
  are done: that clicking "Continue with Google" actually lands back
  signed in, that a brand-new Google account gets a real `athletes`
  row with a sane name/slug, and that an already-invited athlete's
  Google sign-in links to their EXISTING row rather than creating a
  duplicate (relies on Supabase's own automatic identity-linking by
  verified email, not anything this codebase controls).

## Garmin Connect Developer Program (real OAuth + push, Nov 2026)

Starter Access confirmed granted to "LineUps FanXperience Inc." (shared
via a real screenshot of the Garmin Developer Portal): Activity API
(JSON & .FIT), Health API, Women's Health API, Training API, Courses
API — **Delivery: Push only, Historical Data: not included, User
Capacity: up to 1,000 connected users**. Direct instruction once this
was confirmed: "ya tenemos el api de developer de garmin. Conectemosle
a la app."

**This is a completely separate integration from the Garmin Personal
API** documented above (`lib/integrations/garmin.ts`, the
paste-your-own-key flow) — different auth model (real OAuth here,
`GARMIN_DEV_*` env vars, mirrors Strava/COROS exactly), different
capability (this tier can also **push** structured workouts via the
Training API, which the Personal API tier cannot do at all, being
explicitly read-only). Both cards now sit side by side on `/settings`
("Garmin (Developer API)" and "Garmin (Personal key)") rather than one
replacing the other, since an athlete who already connected via the
Personal API loses nothing by this addition.

- **`lib/integrations/garminDeveloper.ts`**: same "generic OAuth2 shape
  is safe, the actual URLs are not" discipline already applied to
  COROS — `GARMIN_DEV_CLIENT_ID`/`_CLIENT_SECRET`/`_AUTHORIZE_URL`/
  `_TOKEN_URL`/`_API_BASE` are required env vars with **no hardcoded
  default**, since `developer.garmin.com` is blocked from this sandbox
  (same standing limitation as COROS's Dropbox-hosted docs) — get the
  real values from the Developer Portal's "Start Guide" /
  "Documentation" pages, and the Client ID/Secret + Authorized Callback
  Domain from the "Apps" section.
- **OAuth routes mirror Strava/COROS exactly**: `/api/garmin-dev/connect`,
  `/api/garmin-dev/callback` (this is literally the redirect_uri to
  register in the Apps section:
  `https://cadenciatraining.vercel.app/api/garmin-dev/callback`),
  `/api/garmin-dev/status`, `/api/garmin-dev/disconnect`.
- **"Delivery: Push only" means there is no pull/poll endpoint at this
  tier** — unlike Strava's manual "Sync now" button, Garmin calls a
  webhook on our side whenever an athlete's device syncs.
  **Confirmed live (Nov 2026) that this is NOT one generic webhook** —
  the real "API Tools -> Endpoint Configuration" page
  (`apis.garmin.com/tools/endpoints`) registers a **separate URL per
  data type**, each its own row with an "on hold"/"enabled" checkbox:
  ACTIVITY - Activities, ACTIVITY - Activity Details, ACTIVITY -
  Activity Files, ACTIVITY - Manually Updated Activities, ACTIVITY -
  MoveIQ, COMMON - Deregistrations, COMMON - User Permissions Change,
  plus a HEALTH - * family (not used — see below) and presumably a
  TRAINING - * family further down the page not yet seen in full.
  `app/api/webhooks/garmin/route.ts` was replaced with
  `app/api/webhooks/garmin/[type]/route.ts` — a dynamic segment, so the
  URL registered for each row encodes its own type
  (`.../garmin/activities`, `.../garmin/activity-details`,
  `.../garmin/deregistrations`, etc.) and a push's type is always known
  for certain from the URL it hit, never guessed from the body.
  **Deliberately only registering Activity/Training/the two COMMON
  rows — not any HEALTH - * row**, matching the APIs actually requested
  on the app (Activity + Training only, not Health/Women's
  Health/Courses). **The real payload shape per type is still
  unconfirmed**, so every delivery is stored verbatim first in
  `garmin_push_events` (`endpoint_type` + `payload jsonb`,
  `processed boolean default false`, migration
  `027_garmin_push_endpoint_type.sql`) rather than guessed and parsed
  blind — same "capture now, parse later" discipline this codebase
  already applies elsewhere to an unconfirmed third-party shape.
  Parsing into real rows (and matching into `workouts`, mirroring
  Strava's auto-complete) is a follow-up once a real payload has
  actually been seen per type. No signature verification is
  implemented either — Garmin's push-signing scheme wasn't
  found/confirmed from this sandbox. **`COMMON - Deregistrations`
  matters for real compliance, not just sync** — it's how we'd learn an
  athlete revoked access from Garmin's own side rather than our
  Disconnect button; a handler that actually deletes the stored
  `garmin_dev_connections` row in response isn't built yet, only raw
  capture.
- **`pushStructuredWorkoutToGarmin()`** reuses the exact same
  `WorkoutStep[]` model already built for COROS — `workout_steps` was
  never COROS-specific. The Training API endpoint path and request
  body field names are **pure placeholders**, same "exists so the UI
  has a stable interface to call, needs a real rewrite once the docs
  are read" caveat already applied to COROS's push function. "Push to
  Garmin" sits next to "Push to COROS" in `WorkoutDialog.tsx`'s
  structured-steps section — same shown-when-steps-exist condition, no
  connection check client-side (the server returns a clear error if
  not connected), mirroring COROS's button exactly.
- **Migration `026_garmin_developer_api.sql`** (mirrored in
  `schema.sql` — **needs this migration run in the Supabase SQL
  editor**): `garmin_dev_connections` (RLS enabled, no policies,
  service-role only, real OAuth tokens — same strictness as every
  other connections table) and `garmin_push_events` (RLS enabled, no
  policies — may hold raw End User health data).
- **Real legal constraint that governs everything built on top of
  this, not just this file**: Section 15.11 of the Garmin Connect
  Developer Program Agreement bars using Garmin Device Sourced Data as
  input to any AI model/system — a plain reading covers even a single
  Claude API inference call, not just training/fine-tuning. **Garmin-
  sourced data (from either the Personal API or this Developer
  Program) must never be passed into
  `lib/integrations/claude.ts`'s `generateActivityDescription()` or
  any future AI feature** (the still-undone Roadmap items,
  "AI-generated training plans" and the "virtual coach agent" — both
  explicitly plan to read an athlete's training history, which would
  need to exclude Garmin-sourced rows specifically once either gets
  built). Nothing today violates this (no AI feature reads Garmin data
  yet), but it's a standing constraint on anything built later, not a
  one-time check.
- Not yet tested against a real OAuth flow from this sandbox (no live
  Garmin Developer Portal app/credentials configured here, and
  `developer.garmin.com` stays unreachable) — **confirm once deployed**:
  set the five `GARMIN_DEV_*` env vars from the real Start
  Guide/Apps page, register the webhook URLs above in the Developer
  Portal, click "Connect" on the new card, and — once a real push
  actually arrives — read a `garmin_push_events` row to finally confirm
  the real payload shape and start building the parser.

### Real app created, confirmed OAuth 2.0 (Nov 2026)

A real App ("Cadencia") was created in the Developer Portal under
"LineUps FanXperience Inc." — Client ID/Secret issued, Key Status
**Approved**, Product **Connect Developer - Starter**, Expires
**Never**. **Confirms `Authorization: OAuth 2.0`** — the generic
OAuth2 authorization-code-grant shape already built in
`lib/integrations/garminDeveloper.ts` is the right shape, not OAuth
1.0a; no code change was needed for this confirmation, only the
standing assumption noted in that file's header is now verified
rather than merely "the more common shape." The Client ID/Secret
themselves go directly into Vercel's env var UI, never into chat (same
security practice applied to every other secret in this project).

**Still blocking a real end-to-end test**: the actual
`GARMIN_DEV_AUTHORIZE_URL`/`GARMIN_DEV_TOKEN_URL`/`GARMIN_DEV_API_BASE`
values — not yet found. The Developer Portal's left nav (seen live) has
an "OAuth2 Tools" section with "User Authorization" and "Refresh
Token" pages specifically, plus a separate "API Documentation" page —
one of those should show the real endpoint URLs/example requests.
Check those next, rather than guessing from the generic
`apis.garmin.com` host seen in the Endpoint Configuration page's own
URL bar (that host alone doesn't confirm the specific OAuth paths).

### Scope widened to every Health + Women's Health endpoint (Nov 2026)

Direct instruction, first narrowed to "sleep pulse ox" then immediately
widened to "quiero usar todas las posibles" — supersedes the earlier
"Activity + Training only, deliberately not Health" scoping decision
documented above. No code change was needed for this: `[type]/route.ts`
already accepts any path segment generically, so every HEALTH - * and
WOMEN_HEALTH - * row just needs its own URL registered in Endpoint
Configuration (same `https://cadenciatraining.vercel.app/api/webhooks/
garmin/<slug>` pattern, e.g. `/sleeps`, `/pulse-ox`, `/hrv-summary`,
`/menstrual-cycle-tracking`) and "Health API"/"Women's Health API"
added to the app's selected APIs via the separate "API Configuration"
tool (not this same Endpoint Configuration page). `src/app/privacy/
page.tsx`'s "What data we collect" section was updated to list every
health category this can now receive, including menstrual cycle
tracking specifically (a sensitive, reproductive-health category under
most data protection laws, flagged here rather than silently folded
into a generic "health data" phrase) — required reading for Garmin's
own app-review checklist ("your privacy statement must clearly state
how Garmin user data is used"). The existing "Garmin-sourced data
never touches any AI system" line in that same page already covers
every one of these new categories without needing its own restatement
— it was never scoped to activity data specifically. Every payload
shape across all these new types is equally unconfirmed as the
Activity ones already noted above — still "capture raw now, parse per
type once a real payload is seen," no exceptions for this wider set.

### Real OpenAPI specs read, Training/Health schemas now confirmed (Nov 2026)

The user pasted the actual OpenAPI JSON for all 4 of Cadencia's API
families straight from the portal's "API Documentation" page (Partner
API, Workout Portal, Health API, Course Portal) — a real, direct
documentation source, not a search summary. This meaningfully upgrades
several things that were previously flagged as pure guesswork:

- **`GARMIN_DEV_API_BASE` is now confirmed**: `https://apis.garmin.com`
  — read directly off every spec's `servers.url` (each API family adds
  its own sub-path on top: Partner API `/partner-gateway`, Workout
  Portal `/training-api/workout`, Health API `/wellness-api`, Course
  Portal `/training-api/courses`). `.env.example` updated with this as
  the actual default value, not blank — the first `GARMIN_DEV_*` var to
  have one.
- **`pushStructuredWorkoutToGarmin()` rewritten against the real
  Workout Portal schema** (`lib/integrations/garminDeveloper.ts`) — no
  longer a guess. Two confirmed calls, not one:
  `POST {API_BASE}/training-api/workout/workout` creates a `Workout`
  (the server base already includes `/training-api/workout`, the path
  adds another `/workout` — a real double segment from the spec, not a
  typo), then `POST {API_BASE}/training-api/workout/schedule` with
  `{workoutId, date}` assigns it to a day. New `sportToGarminShape()`/
  `kindToGarminIntensity()`/`durationTypeToGarminShape()`/
  `targetTypeToGarminShape()` map Cadencia's own enums to Garmin's real
  confirmed ones (`Workout.sport`, `WorkoutStep.intensity`/
  `durationType`/`targetType`). **One real simplification kept,
  flagged in the file**: the confirmed `WorkoutRepeatStep` schema has
  no nested child-steps field, so how Garmin's own repeat-block
  grouping actually works (likely `stepOrder` adjacency) isn't
  confirmed from the spec alone — a Cadencia step with
  `repeatCount > 1` is sent as that many duplicate plain `WorkoutStep`
  entries instead of attempting an unconfirmed `WorkoutRepeatStep`
  wrapper. Functionally equivalent for the athlete, just not using
  Garmin's native repeat-block UI grouping on their end.
- **The OAuth authorize/token URLs were not in those 4 specs** — none
  of them include an OAuth server (they're all data APIs). Resolved
  separately — see the next entry.

### Real PKCE flow confirmed via Garmin's own interactive walkthrough (Nov 2026)

The user then walked through Garmin's own "OAuth2 Tools" interactive
tester (4 steps: generate code verifier/challenge, build the authorize
URL, redirect back, exchange for a token) and shared screenshots of
steps 1, 2, and the token result — a live, confirmed example of the
real flow, not documentation prose. This was a meaningfully bigger
finding than just "here are two URLs":

- **Garmin's OAuth 2.0 requires PKCE** (code_verifier/code_challenge/
  S256) — the authorization-code-grant shape `garminDeveloper.ts`
  originally had was generic OAuth2, not wrong, but incomplete; it
  never generated or sent a code_verifier/code_challenge at all, so it
  would have been rejected. Rewritten: `buildGarminDevAuthorizeUrl()`
  is now `async`, generates a real PKCE pair (`crypto.getRandomValues`
  + `crypto.subtle.digest("SHA-256", ...)`, no external library needed),
  and persists `{state, athlete_id, code_verifier}` in a new
  `garmin_oauth_pkce` table (migration `028_garmin_oauth_pkce.sql`,
  mirrored in `schema.sql` — **needs this migration run in the
  Supabase SQL editor**) so the verifier survives the round trip to
  Garmin's consent screen and back. `state` is now an opaque random
  token (not the athlete id directly, unlike Strava/COROS) — the
  callback looks it up to recover both the athlete id and the
  verifier, then deletes the row. `exchangeGarminDevCode()` gained a
  required `codeVerifier` parameter, sent as `code_verifier` in the
  token request body.
- **Authorize URL confirmed**: `https://connect.garmin.com/oauth2Confirm`
  — read directly from the walkthrough's own displayed query params
  (`client_id`, `response_type=code`, `state`, `redirect_uri`,
  `code_challenge`, `code_challenge_method=S256`; no `scope` param —
  scope is apparently derived server-side from the app's selected
  APIs). **`GARMIN_DEV_TOKEN_URL` is still the one piece left
  unconfirmed** — the walkthrough's step 4 only showed the token
  *response*, not a "Base URL" the way step 2 did for the authorize
  step; still a required env var with no guessed default.
- **Token response shape confirmed** from the real step-4 result:
  `access_token`, `refresh_token`, `token_type: "bearer"`, `scope`
  (space-separated, e.g. `"PARTNER_WRITE PARTNER_READ CONNECT_READ
  CONNECT_WRITE"`), `jti` (unused), `expires_in`, and
  `refresh_token_expires_in` (~90 days seen live — refresh tokens
  expire too; not separately tracked, since Cadencia only ever
  refreshes the access token proactively with a 5-minute margin).
  **No `user_id` field** — the earlier guessed optional field on
  `GarminDevTokenResponse` was removed; `garmin_dev_connections.
  garmin_user_id` stays null for now (the confirmed Partner API spec
  does have `GET /partner-gateway/rest/user/id` that could populate it
  later, not built yet, not needed for the push flow to work).

**Confirmed working end to end live (Nov 2026)**: José clicked
"Connect" on the real `/settings` page after setting all 5
`GARMIN_DEV_*` env vars and running migrations 026-028 — one real bug
found and fixed along the way (below), then a successful OAuth round
trip: redirected to `connect.garmin.com/oauth2Confirm`, consented,
landed back on `/settings` with the card showing **Connected**. The
full PKCE flow (code_verifier generation, `garmin_oauth_pkce` storage,
token exchange with `code_verifier`, row written to
`garmin_dev_connections`) works as built, not just in theory.

- **Bug found live**: the first Connect attempt failed with `"URL is
  malformed"`, because the Vercel env var values had been pasted as
  `GARMIN_DEV_AUTHORIZE_URL=https://connect.garmin.com/oauth2Confirm`
  (the full `NAME=value` line) instead of just the URL in the Value
  field. Not a code bug — flagging it here since it's an easy mistake
  to repeat when setting the remaining Garmin/any other env var later.
- **`GARMIN_DEV_TOKEN_URL` resolved from the JWT itself**, not a
  portal screenshot: the real `access_token` returned by the
  walkthrough's step 4 is a JWT whose decoded payload includes
  `"iss":"https://diauth.garmin.com"` — used as
  `https://diauth.garmin.com/di-oauth2-service/oauth/token`. Worth
  re-confirming directly against the portal's own step-4 display if
  it's ever shown, but the connect flow succeeding live is itself
  strong evidence this value is correct.
- **Not yet tested**: `pushStructuredWorkoutToGarmin()` (the "Push to
  Garmin" button) against this real connection, and no real Garmin
  push has landed in `garmin_push_events` yet either — both still
  pending a live try.
- **The real Health API response schemas are now known** (`ClientSleep`,
  `ClientDailySpo2Acclimation` for Pulse Ox, `ClientHRVSummary`,
  `ClientDaily`, `ClientActivity`, `ClientBloodPressure`, etc., all in
  the Health API spec) — not yet wired into any parser, since a push
  webhook's actual body shape (full payload vs. a lightweight ping
  requiring a follow-up pull) is still unconfirmed; the spec's GET
  endpoints (`/rest/sleeps`, `/rest/pulseOx`, etc., all taking a "Pull
  token" query param) exist for a Pull-tier integration, which Starter
  Access's "Delivery: Push only" means this app isn't using. Once a
  real push lands in `garmin_push_events`, these confirmed field names
  are the reference to decode it against — a real step up from having
  nothing confirmed at all, even though the exact push envelope is
  still open.

## AI-generated structured steps (Nov 2026)

Direct, verbatim complaint while testing the structured-steps editor
manually: "aqui debería ir un ai donde escribes y te genera el
entrenamineto, es una huevada tener que meter manual siempre." A
"Generate with AI" text box now sits above the manual step editor in
`WorkoutDialog.tsx` — type a plain-language description (e.g. "10min
warmup, 6x400m at 5K pace with 90s jog recovery, 10min cooldown") and
it replaces the current step list with the parsed structure, still
fully editable afterward via the existing manual row editor.

- **`lib/integrations/claude.ts`'s `generateWorkoutStepsFromPrompt()`**
  reuses the same direct-fetch-to-the-Messages-API pattern this file
  already had (`generateActivityDescription()`) rather than introducing
  the Anthropic SDK as a new dependency for one more call — same model
  (`claude-sonnet-5-5`), same endpoint.
- **A forced tool call was NOT used** — `tool_choice: {type: "any"}`/
  `{type: "tool", name}` return a 400 on `claude-sonnet-5-5` (current
  API behavior). Instead: `strict: true` on the one tool
  (`set_workout_steps`, schema-validates `tool_use.input` exactly) +
  `tool_choice: {type: "auto"}` + an explicit system instruction to
  always call it and never reply with plain text — same practical
  guarantee of clean structured JSON back, without the forced-choice
  parameter Sonnet 5.5 rejects.
- **Numeric fields use `0` as "no value" inside the tool schema, then
  get normalized to `null`** after the call (`durationValue`/
  `targetLow`/`targetHigh` > 0 kept, else `null`; `repeatCount` > 1
  kept, else `null`) — `WorkoutStep`'s real fields are nullable, but a
  JSON Schema nullable union wasn't confirmed safe under `strict: true`
  mode, so the schema itself stays all-`number`/`string` and the
  conversion happens in application code instead.
- **Explicitly told not to invent a target number** when the athlete
  names an intensity with nothing to derive it from (e.g. "5K pace",
  "easy") — same "never invent data not given to you" rule this file's
  `generateActivityDescription()` already follows; `targetType` falls
  back to `"open"` in that case rather than guessing a pace/HR/power
  value.
- **Unlike `generateActivityDescription()`'s best-effort/silent-skip
  pattern**, this is a direct interactive action (the athlete clicked
  Generate and is watching) — `generateWorkoutStepsFromPrompt()`
  throws on any failure (`ANTHROPIC_API_KEY` missing, bad response
  shape, no tool call returned) and `POST /api/workouts/generate-steps`
  surfaces that as a real error message under the input box, not a
  silent no-op.
- Returned steps carry no `id` (`Omit<WorkoutStep, "id">[]`) — the
  dialog assigns a fresh one per step with the same `newStepId()`
  helper a manually-added step already uses.
- New endpoint has no special scoping (any signed-in athlete can
  generate steps for any workout) — matches the existing "shared coach
  log" openness this app already has for editing any workout.

### Garmin workout-creation URL bug found and fixed the same session (Nov 2026)

Live-testing "Push to Garmin" right after this, the real Workout Portal
rejected the create call with `405 "This endpoint supports 'DELETE',
'GET', 'PUT'"` — direct evidence the URL
`pushStructuredWorkoutToGarmin()` built was wrong, overriding what the
written OpenAPI spec seemed to say. The spec's create operation path is
literally `/workout`, which looked like it should append onto
`servers.url` (already ending in `/training-api/workout`) for
`.../training-api/workout/workout` — but a real POST there routed as
the single-workout-by-id resource (GET/PUT/DELETE), not the collection
create endpoint. **Fixed**: the server base already IS the `/workout`
collection URL — `POST {API_BASE}/training-api/workout` (no extra
segment) is the real create call. `/schedule` wasn't affected (the
server base doesn't already end in `/schedule`, so naive concatenation
was already correct there) — only the workout-creation URL changed.
**This same double-prefix trap may affect Course Portal if it's ever
built** (`servers.url` ends in `/courses`, and its own documented paths
start with `/courses` again) — verify live before trusting naive
concatenation there too, don't assume the pattern definitely repeats.

### Widened to the whole dialog, redesigned (Nov 2026)

Direct, verbatim follow-up: "mejora el diseño de todo esto. Ese ai
debería editar absolutamente todo el pop up" — the AI generator above
only filled `workoutSteps`; now it fills the entire workout.

- **`generateWorkoutStepsFromPrompt()` → `generateWorkoutFromPrompt()`**
  in `lib/integrations/claude.ts`: the tool (`set_workout`, still
  `strict: true` + `tool_choice: "auto"` for the same Sonnet-5.5
  forced-tool-use-is-rejected reason as before) now also returns
  `sport`, `title`, `workoutType`, `minutes`, `km`, and `notes` —
  `sport` is constrained to Cadencia's own `SPORTS` enum, defaulting to
  `"run"` only if truly nothing in the description suggests otherwise
  (never left blank, since `Workout.sport` is a required field).
  `notes` is explicitly instructed to explain the workout's purpose in
  1-3 sentences — same "this is the field that carries the workout's
  objective" role `notes` already has for the `.ics` export (see the
  Roadmap section above).
- **Route renamed** `/api/workouts/generate-steps` →
  `/api/workouts/generate` to match the wider scope.
- **`WorkoutDialog.tsx`**: the AI box moved from inside the structured-
  steps section to the top of the dialog, right under the title, above
  the template picker — it's now the primary entry point for filling
  the form, not a steps-only helper. On success it replaces `sport`,
  `title`, `workoutType`, `minutes`, `km`, `notes`, and `workoutSteps`
  all at once (full replace, not a merge-only-what's-mentioned) —
  matches "edita absolutamente todo," and running it again on an
  already-filled dialog is expected to overwrite with the new
  description, not partially blend two descriptions together.
  `athleteSlug`/`date`/`start`/`stravaComment`/`done`/`rpe` are left
  alone — context the dialog itself already supplies, or (for
  `stravaComment`) a field with its own separate "AI drafts it at sync
  time if left blank" behavior that this generator deliberately
  doesn't duplicate.
- **Visual redesign** of the rest of the dialog alongside this, same
  feedback pass: the form scrolls internally now
  (`max-h-[calc(100dvh-24px)] overflow-y-auto` on the `<form>` itself,
  not just the `<dialog>`) rather than only being bounded by the
  dialog's own max-height with no internal scroll; small uppercase
  tracked section labels (matching the Zenit-inspired micro-label
  style already used elsewhere in this app) replace a couple of plain
  field-style labels for section headers (Structured steps); a
  `border-t border-line pt-4` divider separates the structured-steps
  section and the Done/RPE section from what's above, instead of
  everything running together in one undifferentiated block.

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.
