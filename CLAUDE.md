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

### Juan hit "invalid or expired" live; a third, related Supabase email
### rate limit also found (Nov 2026)

Juan reported the exact error from item 2 above, confirming the
Supabase dashboard's email-template setting still isn't confirmed
applied (#2 is still open, not actually fixed). Two concrete follow-
ups from that report:

- **`accept-invite/page.tsx` now distinguishes two failure causes**
  instead of one generic message — `LinkErrorKind` (`"no_token" |
  "verify_failed"`): if the page's URL carried no `token_hash`/`code`
  at all, that's near-certain proof the email template is still
  `{{ .ConfirmationURL }}` (item 2 above), so the shown message says
  so directly and points at this file instead of the generic "invalid
  or expired" text, which is now reserved for when a real token WAS
  present but verification still failed (genuinely expired/already
  used). Pure diagnostic improvement — doesn't fix the underlying
  dashboard setting, which still needs doing (see item 2 above).
- **A separate, real Supabase error surfaced the same day**: `POST
  /api/admin/athletes/invite` returned "email rate limit exceeded"
  (shown verbatim in `/admin`'s invite form, which already passes the
  API's raw error through). This is Supabase Auth's own built-in email
  sender — used whenever **no custom SMTP is configured** for this
  project — which caps outbound auth emails very low (a handful per
  hour) specifically to prevent abuse of its shared relay. Not a code
  bug; this project has never had custom SMTP configured. **Fix**:
  Supabase Dashboard -> Authentication -> Emails -> SMTP Settings ->
  enable Custom SMTP with a real provider (Resend, SendGrid, Gmail,
  etc. — the Operations Hub codebase's own CLAUDE.md documents the
  exact Resend SMTP settings already used for a sibling AxisKey
  project, reusable here with this project's own sender address) —
  once set, this strict default limit no longer applies. Until that's
  done, repeated invite/reset attempts in a short window will keep
  hitting this same error, and may also be a contributing cause behind
  Juan's own link failure if several were sent back to back the same
  day.

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
  `athleteSlug`/`date`/`start`/`done`/`rpe` are left alone — context
  the dialog itself already supplies. (`stravaComment` was ALSO left
  alone in this original pass, relying on its own separate "AI drafts
  it at sync time if left blank" fallback instead — reversed in the
  "always AI-filled" follow-up below.)
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

### "Strava comment" is now always AI-filled by the generator too (Nov 2026)

Direct, verbatim instruction: "este strava comment siempre hay que
llenarlo con el ai. es un breve resumen del entrenamiento que va a la
descripción de la actividad de strava cuando se hace push." Reverses
the one field the pass above deliberately left alone.

- **`lib/integrations/claude.ts`**: `GENERATE_WORKOUT_TOOL`'s schema
  (and `GeneratedWorkout`) gained a required `stravaComment` field — a
  short, **past-tense** recap (1-2 sentences, e.g. "Tempo run with a
  15min warmup, 30min at tempo pace, 10min cooldown.") written as if
  the session already happened, since it's meant to be posted verbatim
  as the Strava activity's own description once synced — the system
  prompt explicitly calls this out as "must always be filled in, never
  left blank," same as `notes` already was.
- **`WorkoutDialog.tsx`**'s `generateWorkoutFromAI()` full-replace now
  also sets `stravaComment` from the result, alongside everything else
  it already replaced.
- **This is additive, not a replacement** for the existing sync-time
  fallback (`generateActivityDescription()` in the same file, called
  from `/api/strava/sync` only when `strava_comment` is still empty at
  match time) — a workout built with "Generate with AI" now already
  has a comment the moment it's created, so that fallback simply never
  fires for it; a workout NOT built via the AI generator (manual entry,
  a template, Excel import) still relies on the sync-time fallback
  exactly as before, unchanged.

## WorkoutDialog usability pass + header cleanup (Nov 2026)

Several direct, concrete complaints in one session:

- **"no se entiende esta sección... no se si son minutos"**: the
  structured-step duration input showed raw seconds (e.g. `2100` for
  35 minutes) with the unit only in a placeholder — which disappears
  the instant a value is typed, leaving a bare, unlabeled number.
  `StepRow` in `WorkoutDialog.tsx` now displays/edits **minutes** for a
  `"time"` step (converted to/from seconds under the hood, where the
  data model and Garmin's API both still expect seconds) with a
  persistent unit label next to the input (`min`, not a placeholder).
  The same persistent-label fix was applied to the pace/HR/power/
  cadence target fields (`sec/km`, `bpm`, `W`, `rpm`) for the identical
  underlying bug.
- **"falta una X para salirse o aplastar afuera"**: `WorkoutDialog`'s
  native `<dialog>` had no close affordance besides the Cancel button
  at the very bottom. Added an × button next to the title, and a
  click-outside-to-close handler — native `<dialog>` has no built-in
  version of this, and a backdrop click still targets the dialog
  element itself, so a bounding-rect check (not `e.target` identity,
  unreliable once the inner form's own padding is involved) tells a
  real outside click apart from one inside the dialog's own box. Both
  paths call the same `onClose` prop Cancel already uses (not
  `dialogRef.current?.close()` directly), keeping the parent's
  `editing` state as the single source of truth for whether the dialog
  is open.
- **"el sign out, la luna y ES deberían estar en settings"**: moved the
  dark-mode toggle and Sign Out from `SiteHeader`'s nav into `/settings`
  (alongside the language toggle, which was already there) — the header
  nav now only has Calendar/Templates/Settings/Admin. The toggle-theme
  state/logic (localStorage read, `data-theme` attribute) moved with
  it; the inline bootstrap script in `layout.tsx` that applies the
  saved theme before paint is unaffected either way, since it doesn't
  depend on where the toggle button itself lives.
- **"que salga el logo acá"**: the heartbeat/pulse mark (already used
  as the favicon and the Garmin app submission's branding image,
  `public/garmin/app-icon.png`) now also appears next to the
  "cadencia" wordmark in the header — copied to `public/logo.png` as
  the general-purpose copy, a plain `<img>` (not `next/image`, not
  worth the extra config for one fixed small logo) at 28x28 with
  rounded corners.

## New-workout launcher, TrainingPeaks-inspired (Nov 2026)

The user shared a real TrainingPeaks "add activity" screenshot as a
reference ("así se crea una actividad en TrainingPeaks. Es mucho más
completo"). Scope confirmed explicitly via `AskUserQuestion`: **only**
a nicer entry screen using what Cadencia already has — not the
reference's Goals/Metrics/Availability sections or device-file upload
(real concepts TrainingPeaks has that this app doesn't model at all),
and not its much larger sport-type list (Brick, Crosstrain, XC-Ski,
Rowing, etc. — Cadencia still only has its original five:
swim/bike/run/gym/race).

- **`components/NewWorkoutLauncher.tsx`** (new): the first screen shown
  when adding a new workout — a date heading, a "Build with AI" pill
  button, and a grid of the five sport icons (a soft-colored circle +
  colored dot per sport, reusing the exact `.s-<sport>`/`var(--c)`/
  `var(--soft)` accent pattern calendar chips already use, not new
  icon art) — instead of opening straight into a blank
  `WorkoutDialog` form. Picking a sport or the AI option both hand off
  to the same `WorkoutDialog` underneath (which already has its own
  "Generate with AI" box at the top, per the earlier pass) — this is
  purely a nicer entry point, not a second place workout data lives or
  a new API route.
- **`calendar/page.tsx`**: `openAdd(date)` now opens the launcher
  (`launcherDate` state) instead of going straight to `WorkoutDialog`.
  `pickSport(sport)` / `pickAI()` close the launcher and open
  `WorkoutDialog` as before, now via a new `defaultSport` field on
  `EditingState`/`WorkoutDialog`'s `editing` prop (applied in the
  empty-workout branch of its existing "populate `value` from
  `editing`" effect). Editing an *existing* workout
  (`onEdit={(w) => setEditing({ record: w })}`) is unaffected — the
  launcher only ever appears for a brand-new workout, since the sport
  is already known once one exists.

## Structured-step targets linked to the athlete's real zones (Nov 2026)

Direct instruction: "esto debería estar vinculado a las zonas del
usuario... que automáticamente diga qué zonas cardíacas se deben
trabajar." The HR/pace/power target fields in a structured step used
to be free-typed numbers with no connection to the athlete's own
configured zones — now a "Use a zone…" quick-pick appears next to
those fields (whichever target type is selected) and fills
targetLow/targetHigh with that athlete's **real** zone range.

- **`lib/zones.ts` gained `ZONE_ORDER`, `resolveHrZones()`,
  `resolvePowerZones()`, `resolvePaceZones()`** — the exact "Strava's
  configured zones if present, else computed from the manually-entered
  threshold" resolution `ZoneTables.tsx` already had inline, now
  shared so `WorkoutDialog.tsx`'s zone quick-pick uses the identical
  real numbers, not a second guess at them. `ZoneTables.tsx` itself
  was refactored to call these instead of duplicating the logic.
- **`WorkoutDialog`** resolves zones for whichever athlete the workout
  currently belongs to (`value.athleteSlug`, looked up against the
  `athletes` prop already passed in) and threads a `{hr, pace, power}`
  zones object down to each `StepRow`. Cadence has no zone concept in
  this app (no FTP-style cadence threshold), so it stays manual-only.
- **`ZonePick`** (new, generic over `HrZone | PaceZone | PowerZone`):
  a one-shot "action select" (same pattern the template picker already
  uses — `defaultValue=""`, resets after firing) rather than a
  persistently-controlled value. Picking a zone fills targetLow/
  targetHigh but doesn't lock the field to exactly that band — the
  number inputs above it stay freely editable for fine-tuning after.
  Only rendered when that athlete actually has the relevant zones
  resolved (no threshold set yet = no picker, same as `ZoneTables`'
  own "add the threshold to compute zones" fallback).

## Settings: removed the duplicate zone table (Nov 2026)

Direct complaint, with a screenshot of `/settings`: the heart-rate/pace
zone tables were rendering twice in a row — once inside
`AthleteProfileCard` (added earlier specifically as an at-a-glance
summary, with its own caption pointing down to "Training Zones" for
editing) and again immediately inside `AthleteZonesCard` itself, right
after the very form that caption points to. Removed the second,
truly-redundant render from `AthleteZonesCard` (which also dropped its
now-unnecessary `<>...</>` fragment wrapper back to a plain `<Card>`) —
`AthleteProfileCard`'s copy, together with the editable threshold
inputs still in `AthleteZonesCard`, is the only one left.

## Garmin Health metrics parsed + Dashboard redesigned (Nov 2026)

Built per explicit instruction, after a text-only analysis (no code) of
every Garmin Health API metric this app had access to but wasn't using
yet: "con todas. mejora ese dashboard. piensa como un diseñador uiux y
haz del putas la interfaz" — all of them, and redesign the Dashboard
with real UI/UX thinking.

- **The real blocker this surfaced first**: `garmin_push_events` (and
  `garmin_dev_connections`) had no way to attribute an incoming push to
  a Cadencia athlete — `garmin_user_id` was confirmed never populated
  (see the "Garmin Connect Developer Program" section above). Fixed:
  `fetchGarminUserId()` (new, `lib/integrations/garminDeveloper.ts`)
  calls the confirmed Partner API `GET {API_BASE}/partner-gateway/rest
  /user/id` -> `{userId}` right after a fresh OAuth token exchange
  (`app/api/garmin-dev/callback/route.ts`), storing it on
  `garmin_dev_connections.garmin_user_id`. Best-effort — a failure here
  must never block the OAuth connect itself, since the existing
  Training-API push flow (pushing a structured workout) never needed
  this id at all, only incoming Health/Activity pushes do. **Not
  independently confirmed live from this sandbox** — same caution as
  the Workout Portal's own `/schedule` fix: the spec says this path,
  but Garmin's real router has already surprised this codebase once
  with naive concatenation.
- **Migration `029_garmin_health_metrics.sql`** (mirrored in
  `schema.sql` — **needs this migration run in the Supabase SQL
  editor**): one table per pushed object type —
  `garmin_daily_health` (steps, Body Battery charged/drained, average/
  max stress, resting/average/max HR — all on the same Daily summary
  object per the confirmed spec, so one push = one row, no cross-type
  upsert conflict), `garmin_sleep`, `garmin_hrv`, `garmin_pulse_ox`,
  `garmin_respiration`, `garmin_hydration`, `garmin_health_snapshot`
  (one row per athlete per calendar day, upserted), and
  `garmin_body_comp` (a measurement **event**, not a daily aggregate —
  append-only, since an athlete may weigh in 0, 1, or several times a
  day). Every table carries its own `raw jsonb` column alongside the
  decoded fields specifically so a real payload can always be diffed
  against the parser later. Device-measured VO2max/VO2max-cycling/
  Fitness Age (the "user-metrics" push) went straight onto `athletes`
  as plain columns instead (`garmin_vo2max`, `garmin_vo2max_cycling`,
  `garmin_fitness_age`, `garmin_health_synced_at`) — the dashboard only
  ever wants the current number, same reasoning `strava_weight_kg`/
  `strava_stats` already use for other Strava-sourced athlete-level
  fields. **Deliberately kept separate from the existing manually-
  entered `vo2max` column** — one is device-measured, one is athlete-
  entered, and the UI labels which is which rather than silently
  merging them. All eight new tables: RLS enabled, `select` open to
  `authenticated` (same "shared coach log" openness
  `strava_activities`/`strava_daily_load` already have), written only
  by the service-role webhook/parser.
- **`lib/integrations/garminHealthParse.ts`** (new) decodes a raw
  `garmin_push_events` payload into these tables, dispatched by
  `endpoint_type` (the URL slug the push actually hit — see the
  webhook route below). **Read this file's own header comment before
  trusting it** — it's explicit about confidence level: the *object*
  names (ClientSleep, ClientHRVSummary, ClientDaily,
  ClientDailySpo2Acclimation, etc.) are confirmed from the real OpenAPI
  spec pasted into this session earlier, but the individual *field*
  names inside each decoder (`durationInSeconds`,
  `bodyBatteryChargedValue`, `timeOffsetSpo2Values`, etc.) are
  reconstructed from Garmin's well-documented public Health API
  conventions, not copied verbatim from that spec text in this pass —
  this file's own context window didn't retain the literal field list
  at that granularity. Every decoder is therefore deliberately
  defensive (a `pick()` helper tries several plausible key names/paths
  per field, falls back to `null`, never throws) and the push envelope
  itself (array of records? wrapped under a pluralized key? a single
  object?) is also unconfirmed, handled by `extractRecords()` trying
  all three shapes. **Two things have to happen before trusting this
  blindly**: a real push has to actually land in `garmin_push_events`,
  and its raw payload (preserved in every table's own `raw` column)
  needs to be diffed against the `pick()` paths and corrected where
  they don't match — same "capture now, parse per type once a real
  payload is seen" discipline this codebase already applies to every
  other unconfirmed Garmin shape. SpO2 and respiration's "average"
  values are explicitly computed by this codebase from raw per-epoch
  reading maps (`timeOffsetSpo2Values`/`timeOffsetEpochToBreaths`), not
  a Garmin-reported daily summary number — labeled that way in the UI
  rather than presented as if Garmin itself reported a daily average.
  Body composition's mass fields are converted from grams to kg
  (Garmin's documented convention for that object), with a `*Kg`
  variant also checked defensively in case the real payload differs.
- **The webhook route** (`app/api/webhooks/garmin/[type]/route.ts`)
  now calls `processGarminPushEvent(type, payload)` right after storing
  the raw row, best-effort (a parse failure is logged, never turns the
  200 ack into a failure — Garmin would retry/back off an endpoint that
  errors). Its own header comment was updated to reflect the "Scope
  widened to every Health + Women's Health endpoint" change already
  documented above — HEALTH - * rows are now expected and parsed
  (Women's Health rows are still only captured raw, not decoded).
- **`components/GarminHealthPanel.tsx`** (new) — the actual dashboard
  redesign, rendered on `/calendar`'s bottom panel
  (`DashboardPanel.tsx`), solo-athlete-only (same gating as
  `FitnessPanel`/`StravaTotals` right below it), placed first in that
  stack since recovery/readiness is the most actionable thing to see
  before training-load trend or raw Strava totals. UI/UX decisions
  made deliberately, not just "show every field":
  - A **hero row of 4 tiles** — Sleep score, HRV, Body Battery,
    Stress — the four metrics that together answer "how recovered am
    I," each with a 14-day sparkline trend where history exists.
  - **No fabricated "is this good?" verdict for HRV, SpO2, or
    respiration** — shown as plain numbers with a trend line only,
    never a status label, since HRV especially is highly individual
    and this app has no personal baseline to compare against; a
    fabricated universal threshold would be exactly the kind of
    overclaiming this codebase avoids elsewhere (Best Efforts never
    called "PR," Fitness/Fatigue/Form always labeled "estimated," etc).
  - **Sleep Score and Stress DO get a light band label** ("Excellent"/
    "Good"/"Fair"/"Poor" for sleep; "Rest"/"Low"/"Medium"/"High" for
    stress) — but only because these use Garmin's own publicly
    documented 0-100 scales, not a threshold invented by this
    codebase; labeled and reasoned about as such in the component's
    own header comment. The green/red tint on "Excellent" sleep and
    "High" stress is the one place this pass reaches for `--success`/
    `--error` outside a sync failure — judged a genuine, non-routine
    state worth flagging, in the same spirit as (not an exception to)
    the "reserved for real alerts" rule.
  - **Body Battery is shown as charged vs. drained for the day, not a
    fake "current level"** — the Daily summary object only has net
    charged/drained values, not a live current-battery-level field, so
    presenting it as a live gauge would be inventing a number Garmin's
    push data doesn't actually give this app.
  - A **secondary row of smaller stat chips** (SpO2, Respiration,
    Hydration, device VO2max, Fitness Age) plus a **Body Composition
    strip** (weight/body fat/body water/muscle mass/BMI, dated by its
    real `measured_at`) sit below the hero row — real numbers, lower
    visual weight, since they're not the "recovery at a glance"
    headline but are still worth having on the page.
  - **A clear, honest empty state** — since no real Garmin push has
    landed from this sandbox yet (see above), the panel checks
    `garmin_dev_connections` for this athlete and shows "connected, no
    data synced yet" vs. "not connected, connect from Settings" rather
    than rendering a dashboard full of dashes/zeros, which would read
    as broken rather than simply empty.
- Per Section 15.11 of the Garmin Developer Program Agreement (see the
  "Garmin Connect Developer Program" section above), nothing decoded
  or displayed here is ever passed into `lib/integrations/claude.ts`
  or any AI feature — confirmed true of every file touched in this
  pass.
- **Not yet tested against a real push from this sandbox** (same
  standing limitation as the rest of the Garmin Developer Program
  integration) — confirm once deployed: run migration 029, trigger a
  real sync from a connected Garmin device, read the resulting
  `garmin_push_events` row(s) to see the real envelope and field names,
  correct `garminHealthParse.ts`'s `pick()` paths wherever they don't
  match, and confirm the Dashboard panel renders real numbers instead
  of the empty state.

## Fitness/Fatigue/Form switched to WHOOP Strain, promoted on Calendar (Nov 2026)

Direct instruction right after confirming WHOOP was connected and
comparing against a real TrainingPeaks screenshot showing its own
"Performance Metrics" widget (Fitness/Fatigue/Form): "usa WHOOP strain
en vez de Strava pero igual ponle en calendar visible a esos datos como
Performance Metric. son de las cosas más importantes."

- **Data source switched from Strava's Relative Effort to WHOOP's
  Strain** — `components/FitnessPanel.tsx` now reads `whoop_cycles`
  (`strain`, already WHOOP's own 0-21 cardiovascular-load score, a
  platform-native number rather than Strava's derived
  `suffer_score`) instead of `strava_daily_load`. One `whoop_cycles`
  row is roughly one physiological day already, so no per-activity
  summing is needed the way Strava's old version needed (multiple
  activities could land on one day); multiple cycles on the same
  calendar date are still summed defensively, same reducer pattern
  the old version used. The local date is approximated from
  `start_at`'s UTC date (not corrected for the cycle's own
  `timezone_offset`) — a deliberate, labeled approximation, same
  "estimated" honesty this panel already carried in its header.
- **`/api/whoop/sync` now fetches 90 days of cycles specifically for
  this** (`FITNESS_HISTORY_DAYS` in `app/api/whoop/sync/route.ts`,
  mirroring Strava's own identically-named constant and rationale —
  CTL's 42-day time constant needs real room to converge), while
  sleep/recovery/workouts stay at the existing 30-day `SYNC_DAYS`
  window — nothing downstream needs 90 days of those. Cycles are small
  objects, so this is a cheap second window on the same `fetchWhoopCycles`
  call, not a second API round trip shape.
- **Promoted from the bottom of the Dashboard to the very top of
  `/calendar`'s Dashboard section** (`DashboardPanel.tsx`), directly
  under an eyebrow label literally named "Performance Metrics" — the
  exact English term from the TrainingPeaks reference screenshot, per
  "son de las cosas más importantes." It's now the first thing a solo
  athlete sees under the "Dashboard" heading, before the KPI grid, the
  volume chart, or any of the Garmin/WHOOP raw-data panels further
  down — no longer buried after several screens of scrolling.
- `strava_daily_load` itself is left in place, untouched — still
  written by `/api/strava/sync`'s own lightweight 90-day pass, just no
  longer read by anything. Not dropped, since ripping out a working
  write path for no behavioral reason isn't worth it, and it may be
  useful again if WHOOP data is ever unavailable for an athlete who
  only has Strava connected (not handled as an automatic fallback in
  this pass — today the panel simply shows its own "no data" empty
  state for an athlete with WHOOP not connected, even if they have
  Strava history).

## Every dialog gets a close X + click-outside (Nov 2026)

Direct instruction, with a screenshot of `ActivityDetailDialog` open
with no visible way to close it besides the Cancel button at the very
bottom: "asegurate que haya x para salir en todos los popups de la app
y si aplastas afuera igual" — make sure every popup in the app has an
X to close, and that clicking outside closes it too. `WorkoutDialog`
and `NewWorkoutLauncher` already had both (see the "WorkoutDialog
usability pass" section above); audited every `<dialog>` in the app
(`grep -rl "<dialog"`) and found two that didn't:

- **`ActivityDetailDialog.tsx`** — added the same `handleDialogClick`
  bounding-rect click-outside handler and an × button next to the
  title row (the title block is 3 lines — eyebrow/name/date — so the
  header row uses `items-start`, not `items-center`, to keep the ×
  aligned with the top line rather than vertically centered against
  the whole block).
- **The inline template editor dialog on `/templates`**
  (`app/templates/page.tsx`) — same fix, same pattern. This one had
  neither an × nor a click-outside handler at all before this pass.

Both reuse the exact same bounding-rect check `WorkoutDialog.tsx`
established (comment there explains why: a backdrop click still
targets the `<dialog>` element itself, so `e.target` identity alone
can't tell an outside click from an inside one once the inner
form/content has its own padding).

## WHOOP integration (Nov 2026)

Built immediately after the Garmin Health pass above, per direct
instruction ("nos vamos a conectar a whoop igual") right after the user
pasted the real WHOOP Developer Platform OpenAPI spec into chat — a
genuine, direct documentation source, not a search summary or a
reconstruction from general knowledge.

- **Meaningfully higher-confidence than the Garmin Health parser.**
  Every URL and field name in `lib/integrations/whoop.ts` is copied
  directly from that pasted spec: authorize
  `https://api.prod.whoop.com/oauth/oauth2/auth`, token
  `https://api.prod.whoop.com/oauth/oauth2/token`, API base
  `https://api.prod.whoop.com/developer` — all hardcoded (not env
  vars), same reasoning `STRAVA_AUTHORIZE_URL`/`STRAVA_TOKEN_URL` are
  hardcoded in `strava.ts` rather than configurable, since the spec
  confirms these as fixed values. Only `WHOOP_CLIENT_ID`/
  `WHOOP_CLIENT_SECRET` are env vars (the actual secret).
- **Pull, not push** — the real spec has no webhook/subscription
  endpoint at all, just paginated `GET /v2/cycle`, `/v2/activity/sleep`,
  `/v2/recovery`, `/v2/activity/workout` (all `{records, next_token}`),
  plus one-shot `GET /v2/user/measurement/body` and
  `/v2/user/profile/basic`. So this mirrors **Strava's** manual "Sync
  now" model (`/api/whoop/sync`, 30-day window — same default Strava's
  own sync settled on), not Garmin's webhook-receiver model. There is
  nothing to register with WHOOP beyond the OAuth redirect URI itself.
- **Plain OAuth 2.0 authorization-code grant, no PKCE** — confirmed from
  the spec's `securitySchemes.OAuth`, a real difference from Garmin's
  confirmed PKCE requirement. `state` carries the athlete's id through
  the round trip, same pattern as Strava's callback.
- **Scopes are read-only**: `read:profile read:body_measurement
  read:cycles read:recovery read:sleep read:workout` — there is no
  write scope anywhere in WHOOP's public API, unlike Garmin's Training
  API. No structured-workout push is possible here, by design of the
  platform itself, not a gap in this integration.
- **Token revoke is real** (`revokeWhoopAccess()`, `DELETE
  /v2/user/access`) — actually revokes the grant on WHOOP's own side,
  not just a local row deletion; called best-effort before deleting
  `whoop_connections` on Disconnect.
- **Migration `030_whoop_integration.sql`** (mirrored in `schema.sql`
  — **needs this migration run in the Supabase SQL editor**):
  `whoop_connections` (RLS, no policies, service-role only, same
  strictness as every other OAuth-token table in this app) plus four
  data tables — `whoop_cycles`, `whoop_sleep`, `whoop_recovery`,
  `whoop_workouts` — each keyed by WHOOP's own real id
  (`whoop_cycle_id`/`whoop_sleep_id`/`whoop_workout_id`), `select` open
  to `authenticated` (shared coach log, same as `strava_activities`),
  written only by `/api/whoop/sync`. Body measurement (height/weight/
  max HR) goes straight onto `athletes` as plain columns
  (`whoop_height_m`, `whoop_weight_kg`, `whoop_max_hr`,
  `whoop_profile_synced_at`) — latest value only, same reasoning
  `strava_weight_kg`/`garmin_vo2max` already use for other
  device-sourced athlete-level fields.
- **OAuth routes mirror Strava's exactly**: `/api/whoop/connect`,
  `/api/whoop/callback` (register
  `https://<this app's domain>/api/whoop/callback` as the redirect URI
  in the WHOOP Developer Dashboard), `/api/whoop/status`,
  `/api/whoop/disconnect`, `/api/whoop/sync`.
- **`components/WhoopPanel.tsx`** — a Dashboard panel next to
  `GarminHealthPanel`, same design language (hero stat row, no
  fabricated verdicts, honest empty state distinguishing "not
  connected" from "connected, nothing synced yet") for consistency
  across the two wearable integrations: Strain (WHOOP's own 0-21
  cardiovascular-load score), Recovery %, HRV (`hrv_rmssd_milli`),
  Sleep Performance %, Resting HR, SpO2, skin temperature, and
  respiratory rate — every one of these is WHOOP's own reported value,
  nothing computed by this codebase (unlike Garmin's SpO2/respiration
  averages, which this app derives itself from raw epoch readings).
  `AthleteWhoopCard` on `/settings` mirrors `AthleteStravaCard` exactly
  (status dot, Sync now / Disconnect buttons, no push button since the
  platform has none).
- Per Section 15.11 of the Garmin Developer Program Agreement — not
  applicable here at all, since this is a completely separate platform
  with its own terms; nothing in this integration touches Garmin data
  or the Garmin constraint.
### Live-testing bug: missing `offline` scope, missing error check (Nov 2026)

Two real bugs found and fixed the same day José actually clicked
Connect on the WHOOP card:

1. **`POST /api/whoop/callback` reported success even when the database
   write failed.** `db.from("whoop_connections").upsert(...)` was never
   checked for an `{error}` — Supabase's client returns that, it
   doesn't throw — so a failed write still redirected to
   `?whoop=connected`. Confirmed live: the OAuth consent screen
   completed, the browser landed on the "connected" URL, but the
   Settings card still showed "Not connected" with nothing visibly
   wrong anywhere. Fixed by checking the upsert result and redirecting
   to `?whoop=error` (with the real Postgres error `console.error`'d)
   when it fails — same "never silently succeed on a failed write"
   discipline this codebase applies everywhere else.
2. **Root cause of that failed write, found from the now-visible Vercel
   log**: `null value in column "refresh_token"... violates not-null
   constraint` — WHOOP's real token response came back with
   `refresh_token: null`. Confirmed via web search (developer.whoop.com
   itself is blocked from this sandbox, same as Garmin's and COROS's
   docs) that this is WHOOP's own documented behavior, not a bug on
   either side: **WHOOP only issues a refresh token when the
   authorization request explicitly includes the `offline` scope.**
   `WHOOP_SCOPES` in `lib/integrations/whoop.ts` now requests `offline`
   alongside the six real data scopes (it grants no read access of its
   own, it's purely what unlocks getting a refresh token at all) — used
   in both the authorize URL and the refresh-token request. This also
   means every connection attempt made before this fix shipped silently
   failed the same way (now correctly surfaced as `?whoop=error`
   instead of a false `?whoop=connected`) — no real `whoop_connections`
   row exists yet from any of those attempts; the next Connect attempt
   after this deploy is the real first test.
- Still not confirmed end-to-end from this sandbox — confirm once
  deployed: Connect now actually lands on a real `whoop_connections`
  row (not another silent failure), and a `Sync now` click populates
  all four data tables plus the body-measurement columns on `athletes`.

## Header bar + Settings connections, reorganized (Nov 2026)

Direct follow-up feedback, confirmed via `AskUserQuestion` to cover
both the top nav bar and the Settings integration cards ("la
organización de las cosas" / "mejora la barra de arriba").

- **`SiteHeader.tsx`**: the brand mark and the name/Friends identity
  cluster used to just sit next to each other as plain flex items — a
  `border-l border-line pl-3` now visually separates them. The main nav
  (Calendar/Generate/Settings) used to be plain text links (only a
  color change for the active page) sitting next to Admin's own
  pill-badge styling — two different visual languages for "you are
  here" in one nav. Wrapped the three in one segmented pill group
  (`bg-surface-2` track, `bg-ink` active segment) matching the pill
  aesthetic already used everywhere else in this app (buttons, the
  name/Friends badges) — Admin stays its own separate pill to its
  right, unchanged, since it's a different kind of link (conditional,
  admin-only), not a peer page in the main group.
- **`/settings`'s 5 integration cards** (Strava, COROS, Garmin
  Developer API, Garmin Personal key, WHOOP) used to sit in three
  separate 2-col grids stacked with `mt-4` gaps — the odd number left
  WHOOP alone in its own row (an orphan cell), and the whole stack had
  no section heading, reading as a loose pile of cards rather than a
  labeled section. Now one "Connections" heading (matching this app's
  existing uppercase-tracked micro-label pattern) over one responsive
  grid (`sm:grid-cols-2 lg:grid-cols-3`), ordered by how usable each
  connection actually is today — Strava and WHOOP (both fully working)
  first, Garmin Developer (confirmed working) third, then COROS (still
  pending partner approval) and the lower-capability Garmin Personal
  key last — so if 5 cards in a 3-column grid ever leaves an orphan
  cell on a wide screen, it falls on one of the two least-essential
  cards, not a primary one.
- **Found live (Nov 2026), same pass**: every one of those 5 cards'
  titles repeated the athlete's name ("José Miguel · WHOOP", "José
  Miguel · COROS", etc.) even though `/settings` is provably always
  scoped to exactly one athlete (`useAuth().me` — see "Settings
  simplified to always show only the signed-in athlete's own data"
  above), so the name added nothing and just cluttered the page —
  direct complaint with a screenshot ("etoda esta pagina dice mill
  veces jose miguel"). Dropped the `{name} · ` prefix from all 5 card
  titles plus `AthleteZonesCard`'s (6 total), and removed the now-
  unused `name` prop from each of those 6 components' signatures and
  their call sites in `SettingsContent` — `AthleteZonesCard` still
  takes `slug` (needed for its Supabase query), just not `name`.

## Full codebase audit — 31 findings, 29 fixed (Nov 2026)

Direct instruction to run a structured multi-angle code review across
the entire codebase (correctness, security, performance, readability,
error handling, test coverage) and fix as much as possible directly,
flagging only genuine judgment calls. Done via the `code-review` skill
at `xhigh` effort, split into 6 parallel area reviews (API routes,
`lib/integrations/**`, components, Supabase migrations/RLS, core `lib/`
utilities, auth/admin/pages) since this was a whole-codebase review, not
a diff. 31 verified findings came back; 29 were fixed directly, 2 were
deliberately left alone (explained below).

**Two real unauthenticated endpoints (the most severe findings)**:
`GET /api/plan/template` and `POST /api/plan/import` had no auth check
at all — `template` returned every athlete's full PII (birth date,
height/weight, resting/max HR, goal race, personal bests) to anyone who
hit the URL signed in or not; `import` let an anonymous POST insert
arbitrary `workouts` rows for any athlete. Both now call
`getSignedInAthlete()` first, same gate every other non-admin route in
this app already has.

**The "unchecked Supabase write error" bug class — the single most
repeated issue, found independently in 8+ places**: Supabase's client
returns `{error}` rather than throwing, so a failed write used to look
identical to a successful one everywhere this wasn't checked. Already
fixed once in `whoop/callback` (see that section above); this pass found
and fixed the same pattern in `garmin-dev/callback`, `strava/callback`,
`coros/callback`, `strava/sync`'s daily-load upsert, `whoop/sync`'s four
batch upserts (now returns an `errors` array the Settings card surfaces
in its sync message), `AthleteProfileCard`'s profile save (now shows a
real error instead of silently claiming "Saved"), `ensureAthleteForUser`'s
athlete-row insert, and `calendar/page.tsx`'s `toggleDone` (now rolls
back the optimistic UI update on a real failure).

**Other real bugs fixed**:
- `WorkoutDialog.tsx`'s structured-step duration/target type dropdowns
  now reset the value on a type change — switching a 5000m distance
  step to "time" used to silently reinterpret the same number as 83.3
  minutes instead of resetting it.
- `DashboardPanel.tsx`'s "Recent activities" was sorting ascending
  (oldest-first) since `activities` arrives pre-sorted that way from
  `calendar/page.tsx` — now sorts a copy descending by real `start_date`
  before slicing, independent of any activity's own title/name.
  `VolumeChart`'s week labels were hardcoded to Spanish regardless of
  the app's locale. `recentPage` wasn't reset when the athlete/Friends
  filter changed, which could render a blank table instead of the empty
  state.
- `garminHealthParse.ts`: the per-day upsert did a full-row replace on
  conflict, so a later same-day push with fewer populated fields could
  null out columns an earlier, fuller push for that day had already set
  — fixed with a `mergeWithExisting()` helper that fetches the existing
  row first and fills any null field in the new row from it, for all 7
  per-day tables. `applyUserMetrics` had the identical bug for
  `athletes.garmin_vo2max`/`_cycling`/`garmin_fitness_age` — now only
  includes a field in the update when that specific push actually
  carried it. The athlete-id lookup also ran once per record instead of
  once per push (now cached per `processGarminPushEvent()` call via a
  `Map`). `calendarDateOf()`/`decodeBodyComp()`'s epoch fallbacks used a
  truthy check (`epoch ? ... : null`), which would have treated a
  legitimate epoch of 0 as "no timestamp" — now an explicit `!== null`
  check.
- `strava.ts`/`coros.ts`/`garminDeveloper.ts`/`whoop.ts`'s
  `getValid*AccessToken()` functions had an unsynchronized read-check-
  refresh-persist race: two near-simultaneous calls near expiry both
  read the same refresh_token and both call the provider's refresh
  endpoint; if the provider rotates the refresh token on use, the
  second call gets a real error even though the connection is healthy.
  All four now catch that failure and re-fetch the connection row once
  before giving up — a concurrent call may have already refreshed it.
- `excelPlan.ts`'s `cellToString()` didn't handle ExcelJS rich-text
  cells (Excel's real shape for anything pasted with mixed formatting),
  stringifying them to the literal `"[object Object]"` with no error —
  now extracts and joins the rich-text runs. `timeDiffMinutes()`
  silently returned null (falling back unreported to the Minutes
  column) whenever the end time was numerically before the start —
  a real scenario for an overnight workout (e.g. 22:00-02:00) — now
  wraps past midnight when end is strictly before start, and reports a
  real import error when both the time pair AND the Minutes column are
  unusable, instead of silently importing a 0-minute row.
- `dates.ts`'s `parsePace()` couldn't distinguish a genuinely blank
  field from a real 0, since its caller in `settings/page.tsx`
  pre-defaulted blanks to `"0"` — leaving minutes blank while typing
  only seconds used to save an impossible pace. Fixed in both places:
  `parsePace` now rejects an explicitly blank min/sec string, and the
  call site stopped pre-defaulting to `"0"`.
- `i18n/context.tsx`'s English `nav_templates` entry never got the
  "Generate" rename the Spanish entry (and `tpl_h`, both locales)
  already had — every first-time visitor (default locale is English)
  saw the stale "Templates" label.
- `fitnessForm.ts`'s `computeFitnessForm()` had no guard ensuring its
  internal `start <= end` — if the earliest load date ever landed after
  `today()` (plausible from `FitnessPanel`'s own naive UTC-date slice of
  a WHOOP cycle's `start_at`), the day-loop would never run, `series`
  would stay empty, and the non-optional `current` field would actually
  be `undefined` — a real crash at `result.current.ctl` in every
  caller. `end` is now clamped to at least `start`, plus a defense-in-
  depth empty-series guard before returning.
- `ensureAthlete.ts`: the existing-athlete lookup matched email with a
  case-sensitive `eq`, so an admin-seeded row with `JohnDoe@gmail.com`
  (no `auth_user_id` yet) wouldn't match a later Google sign-in
  normalized to lowercase, inserting a duplicate identity instead of
  linking to the existing row — switched to `ilike`. The row-insert's
  own error was never checked either: two near-simultaneous sign-ups
  with colliding names/emails can both pass the "no existing row" check
  before either insert commits, and the second insert then fails the
  unique slug/email constraint — unchecked, this silently stranded that
  user signed in with `me === null` forever. Now checks the error,
  swallows only a real unique-violation (Postgres `23505` — a
  concurrent call already created the row this one needed, not a real
  failure), and rethrows anything else; `/auth/callback/route.ts` wraps
  the call in try/catch so a genuine failure still redirects to the
  existing `?auth_error=1` path instead of an unhandled 500.
- `admin/athletes/[id]/route.ts`'s last-admin demotion guard read the
  admin count and the target row's own flag in two separate,
  unsynchronized queries before writing — with exactly 2 admins, two
  concurrent demotions of different admins could both pass the check
  and leave zero admins. A true fix needs a single atomic check-and-
  write this codebase's plain Supabase client calls can't express, so
  this is a compensating check instead: re-verify the admin count
  actually held zero afterward, and revert the one write if it didn't
  (409), rather than leaving the roster locked out.
- `auth-context.tsx`'s athlete-roster refetch effect depended on the
  whole `session` object, which gets a new reference on every Supabase
  token auto-refresh (roughly hourly) — re-querying the full `athletes`
  table for every open tab with nothing actually changed. Now depends
  on `session?.user.id` (a stable string) instead.
- Migrations `029_garmin_health_metrics.sql` and
  `030_whoop_integration.sql` had `create policy` statements with no
  `drop policy if exists` guard, unlike every other policy-creating
  migration in this codebase — re-running either file a second time
  would error "policy already exists" and abort the rest of the file.
  **Needs these two migrations re-run in the Supabase SQL editor** —
  the added `drop policy if exists` lines are themselves idempotent, so
  re-running is safe even if 029/030 already ran once before this fix.

**Two findings deliberately left as-is**:
1. `garminHealthParse.ts`'s `decodeRespiration()` stores waking and
   sleep respiration rate under one undifferentiated
   `avg_breaths_per_min` column, even though they're genuinely
   different metrics, not alternate spellings of the same value —
   fixing this properly needs a schema decision (two columns, or a
   "which kind" flag) rather than a pure code fix, and the panel
   already labels this whole metric as computed/estimated rather than
   a precise Garmin-reported number. Flagged for a future pass rather
   than guessed at.
2. `strava/sync`'s auto-complete/AI-write-back loop was fully
   sequential (DB query + possible update + a Claude call + a Strava
   PUT per activity, up to 200 pending) — now processed in concurrent
   batches of 5 (`CONCURRENCY` in `app/api/strava/sync/route.ts`)
   rather than either fully sequential (the original timeout risk) or
   fully parallel (which would risk hammering the Claude/Strava APIs
   with 200 simultaneous requests) — a deliberate middle ground, not
   fully "fixed" in the sense of eliminating the risk entirely for a
   truly enormous backlog.

Not yet tested against a real Supabase project/live traffic from this
sandbox — confirm once deployed, in particular: the two unauthenticated
endpoints are actually closed, a real concurrent WHOOP/Garmin/Strava
sync doesn't hit the token-refresh race in practice, and re-running
migrations 029/030 in the SQL editor is actually a no-op now.

## Seeded Base workouts presets (Nov 2026)

The `/templates` ("Generate") page's "Base workouts" preset grid
started empty (`templates` has no seed data of its own — presets were
always athlete-created). Per direct request ("carga entrenamientos al
base workouts"), seeded 20 starting presets from two sources the user
shared in chat:

- **10 run presets** adapted from a fljuga.co.uk article pasted
  directly into chat ("Entrenamientos de carrera Ironman 70.3: 10
  ejemplos de sesiones de entrenamiento") — these were already
  structured as standalone, reusable sessions (purpose, warmup, main
  set with zones, cooldown), a close match for what a preset is.
- **10 swim/bike presets** adapted from an uploaded Garmin 12-week
  Olympic-distance triathlon plan PDF — this one is a full dated,
  periodized calendar (84 sessions across 12 weeks), not a preset
  library, so rather than dump every weekly numeric variant, pulled
  out the genuinely distinct session *types* that recur throughout it
  (technique swim, continuous swim, race-pace swim, open-water swim,
  progressive swim, easy spin, hill repeats, time trial, strong
  intervals, bike-to-run brick) and generalized each into a reusable
  template. Run session types from the PDF were skipped since the
  fljuga article already covers that discipline.
- `minutes`/`km` on each preset are approximate (derived from the
  source's own block breakdown, e.g. summing warmup + main set +
  cooldown) — these are starting points an athlete edits per use when
  dropped onto a day, not a fixed prescription.
- `supabase/migrations/031_seed_base_workout_templates.sql` (mirrored
  in `schema.sql`) — idempotent per row (`where not exists (select 1
  from templates where title = '...')`, matched by title, since
  `templates` has no unique constraint and an athlete creating their
  own duplicate-titled preset later is legitimate) — **needs this
  migration run in the Supabase SQL editor**.

## Base Workouts: search, bilingual text, a real "brick" sport (Nov 2026)

Direct, concrete follow-up feedback right after the presets above shipped,
four distinct complaints in one message:

1. **"no entiendo de qué sirve el Base Workouts si es que no hay cómo
   añadir al calendario"** — there was no real way to get a preset onto
   the calendar; the only picker was a small `<select>` buried inside
   `WorkoutDialog`, shown only once a new-workout dialog was already
   open. **`NewWorkoutLauncher.tsx` gained a third entry point** ("Build
   with AI" / "Search for Workouts" / "Add a Workout", exactly the three
   the user asked for) — picking "Search for Workouts" switches the same
   dialog into a search screen (text filter + sport filter, both
   client-side over the `templates` prop now also passed into this
   component) and tapping a result opens `WorkoutDialog` already
   pre-filled from that preset. `WorkoutDialog`'s `editing` prop gained
   `defaultTemplateId?: string` for this — its init effect looks the
   template up and merges `sport`/`title`/`minutes`/`km`/`notes` into the
   new-workout defaults, the same fields `applyTemplate()` already set
   for the existing inline `<select>` (kept as-is, a quicker in-dialog
   alternative once a sport is already picked).
2. **"no hace constancia el idioma de los Base Workouts con el idioma en
   el cual está la plataforma"** — the 20 seeded presets were plain
   Spanish text with no connection to the EN/ES toggle. `templates`
   gained optional `title_en`/`notes_en` columns (migration
   `032_templates_bilingual_and_brick_sport.sql`, mirrored directly into
   `schema.sql`'s own seed block in its already-correct final form, not
   as a second pass). **`lib/templates.ts`**'s `templateTitle()`/
   `templateNotes()` is the one shared helper every reader goes through
   (the Base Workouts grid on `/templates`, `WorkoutDialog`'s inline
   select, `NewWorkoutLauncher`'s new search list) — English when the
   viewer's locale is English and a translation exists, else always the
   Spanish text, never a blank field. The `/templates` editor dialog
   gained matching "Title (English, optional)"/"Details (English,
   optional)" fields with a caption explaining the fallback, so an
   athlete adding their own preset later can fill both languages the
   same way.
3. **"Los entrenamientos que son bricks deberían estar marcados no como
   bike, sino como bike and run"** — confirmed via `AskUserQuestion`
   given this reverses an explicit prior scoping decision
   ("`NewWorkoutLauncher`... no new sport types beyond Cadencia's
   existing five"): the user chose a real 6th sport, not a cosmetic
   label. **`brick` is now a full `Sport`** — in `SPORTS`/`Sport` (
   `lib/types.ts`), its own accent token (`--brick`/`--brick-soft` in
   `globals.css`, a muted sage-green distinct from all five existing
   hues, the `.s-brick` utility class), its own `t("brick")`/
   `t("bike")`-sibling i18n label ("Bici + Trote"/"Bike + Run"), and a
   widened check constraint on both `workouts.sport` and
   `templates.sport` (migration 032 finds and drops each table's
   existing unnamed check constraint dynamically via `pg_constraint`
   rather than guessing its auto-generated name, then re-adds it with
   `brick` included). The one seeded brick preset ("Brick
   bici-carrera"/"Bike-to-run brick") is re-tagged `sport = 'brick'`
   (migration 031 had it as `'bike'`, since `'brick'` wasn't a valid
   value yet when that migration ran). Every other place `Sport` is
   enumerated picked this up automatically through `SPORTS.map(...)` or
   a `default:` branch (the calendar grid, the sport picker, the Excel
   plan's dropdown/matcher, the Dashboard's by-sport breakdown) — three
   places needed an explicit addition because they're `Record<Sport,
   ...>` types or hand-written switches: `lib/racePredictor.ts`'s
   `DISTANCE_PRESETS` (brick -> `[{label: "Custom", meters: null}]`,
   same as gym), `DashboardPanel.tsx`'s volume-chart `sportColors`
   (`var(--brick)`), and `lib/integrations/garminDeveloper.ts`'s
   `sportToGarminShape()` (brick -> the confirmed `MULTI_SPORT` Garmin
   enum value — a real, closer match than the `GENERIC` fallback every
   other unmapped case uses, still unconfirmed against a live push).
   **Deliberately NOT touched**: `lib/sport.ts`'s
   `mapStravaSportType()` — Strava logs one activity as exactly one
   `sport_type`, never a combined brick, so an individual synced
   activity can never resolve to `"brick"`; this means a brick-tagged
   planned workout can't be auto-matched by Strava sync's exact-sport
   rule, a known, accepted gap (now commented in that file), not
   something this pass tried to solve.
- Not yet tested against a real Supabase project from this sandbox (same
  standing limitation as every other Supabase-dependent feature here) —
  confirm once deployed: run migration 032, confirm a brick preset shows
  its own green accent and "Bike + Run" label everywhere, confirm
  "Search for Workouts" actually opens `WorkoutDialog` pre-filled
  correctly from a real preset, and confirm switching the platform to
  English shows the translated preset text (and reverts to Spanish for
  any preset with no English filled in).

## COROS Partner API application superseded by COROS MCP (Nov 2026)

A real, direct reply arrived from `api@coros.com` (not a search summary —
the user forwarded the actual email), and it changes the COROS picture
significantly from everything documented above under "COROS structured-
workout push (prep work, Oct 2026)":

- **For Cadencia's exact use case — pushing structured interval workouts
  (warmup/interval/recovery/cooldown with pace/HR/power targets) for
  run, trail run, and cycling — the Partner API this codebase was built
  against is the WRONG path entirely, not just unapproved.** COROS's own
  words: "MCP covers your use case today with no application or approval
  needed." The Partner API application already submitted (the one this
  file's earlier sections describe waiting on) is for a *different* set
  of capabilities — webhook push notifications, GPX route import/export,
  two-way activity sync — none of which Cadencia has asked for yet. If
  any of those are wanted later, that application is still the right
  path (form linked in the email); for everything built so far, it
  isn't.
- **COROS MCP** is a Model Context Protocol server, not a plain REST
  API — confirmed real endpoint: `https://mcp.coros.com/mcp` (regional
  alternates also confirmed from COROS's own GitHub docs repo,
  `coroslab/COROS-MCP`, which — unlike the old Dropbox-hosted Partner
  API guide — this sandbox CAN reach via `raw.githubusercontent.com`:
  `https://mcpcn.coros.com/mcp` China, `https://mcpeu.coros.com/mcp`
  Europe, `https://mcpus.coros.com/mcp` US/other). No application or
  approval needed, free, personal/non-commercial projects fully
  eligible. Swim write is explicitly not available via MCP yet (run,
  trail run, cycling only) — matches Cadencia's own `brick` sport
  gap too (COROS has no "brick" sport in its own tool surface either,
  per the tool table below; a brick workout pushed to COROS would need
  to become two separate single-sport pushes, not attempted yet).
- **The real write tools are now confirmed** (from
  `coroslab/COROS-MCP`'s `docs/en/tools.md`, reached via
  `raw.githubusercontent.com` — `github.com`'s own page and
  `api.github.com` are blocked from this sandbox, but raw file URLs
  on that specific subdomain work): `createTrainingPlan`/
  `updateTrainingPlan` (multi-week plans, 4-16 weeks, running/cycling/
  trail running), `createSingleWorkout`/`updateWorkoutDetails` (single
  library workouts), `scheduleWorkout` (places an existing library
  workout on a date, up to 90 days out), `createScheduledWorkout`/
  `updateScheduledWorkout` (a standalone workout directly on a specific
  date, not saved to the library — the closest match to how Cadencia's
  own `workouts` rows already work, one dated row per workout). Every
  write tool's workout content is a `course` object described only as
  containing "name, sport, sections, and training targets" — **the
  internal schema for sections/steps (warmup/interval/recovery/
  cooldown) and pace/HR/power targets is NOT in any doc this sandbox
  could reach**, so still unconfirmed, same caveat the old Partner-API
  `tp/list/push` guess carried. Read tools are also now confirmed
  (`queryTrainingPlanLibrary`, `queryTrainingPlanDetails`,
  `queryTrainingSchedule`, `queryWorkoutLibrary`, `queryWorkoutDetails`,
  `queryScheduledWorkoutDetails`, `querySportRecords`,
  `getActivityDetail`, `queryActivityLapData`,
  `queryCustomActivityLapData`) — a real pull-sync feature (mirroring
  Strava/WHOOP's own "Sync now") is newly possible here that wasn't
  confirmed as existing at all under the old Partner-API framing.
- **A genuinely useful property of MCP that doesn't exist for any other
  integration in this codebase**: every tool's full input schema is
  self-describing via the protocol's own `tools/list` call — once a
  real OAuth connection exists, Cadencia can ask the MCP server for the
  real `course` schema directly instead of needing it handed over in a
  doc. This is the concrete next step once connecting is possible at
  all (see below), not another round of doc-hunting.
- **Still unconfirmed and blocking any real implementation**: the exact
  OAuth 2.0 mechanism for a custom (non-ChatGPT/Claude-connector-UI)
  application. The email says "implement OAuth 2.0 in your app... any
  OAuth 2.0 client library will work" with **no mention anywhere of a
  developer-portal client-ID step** — unlike every other integration in
  this codebase (Strava, WHOOP, Garmin Developer), which all required
  registering an app somewhere first. That absence is consistent with
  the official MCP Authorization spec's standard shape (metadata
  discovery via `.well-known/oauth-protected-resource` +
  `.well-known/oauth-authorization-server`, then Dynamic Client
  Registration per RFC 7591, then PKCE) — a real, published standard,
  the same "generic OAuth2 is safe to code, specific URLs are not"
  confidence tier this codebase already extends to Strava/WHOOP's
  classic OAuth2 shape — but this is an **inference from absence**, not
  confirmed the way COROS's regional MCP URLs and tool names now are.
  The one page that most likely spells this out plainly — support.
  coros.com's "Build on COROS MCP" article, specifically its "Setup
  Guide" section for "other platforms, manual MCP setup" (as opposed to
  the built-in ChatGPT/Claude connector flow) — is **blocked from this
  sandbox's egress proxy** (`support.coros.com` fails the CONNECT
  tunnel, same as `developer.garmin.com` was before Garmin's real docs
  got pasted directly into chat). Direct network probes from this
  sandbox against `mcp.coros.com` itself (its `.well-known` discovery
  endpoints) are also blocked the same way, so the discovery mechanism
  couldn't be confirmed by calling it live either.
- **`lib/integrations/coros.ts`'s existing Partner-API-shaped scaffold
  (OAuth env vars, `buildCorosAuthorizeUrl`, `pushStructuredWorkoutToCoros`
  posting to a guessed `tp/list/push`) was left in place but clearly
  flagged superseded at the top of the file**, rather than half-rewritten
  against an unconfirmed OAuth mechanism — building a new MCP JSON-RPC
  client (the official `@modelcontextprotocol/sdk` package is the
  obvious tool for this, not yet a dependency) and a Dynamic Client
  Registration flow blind, with no way to test any of it from this
  sandbox and a real chance the OAuth inference above is wrong, would
  very likely mean throwing it away and starting over once the real
  Setup Guide is actually read — the same reasoning this codebase
  already applies everywhere else to an unconfirmed integration shape
  (Garmin's env vars with no baked-in default, the old COROS Partner-
  API scaffold itself). `/settings`'s COROS card copy was updated to
  say plainly that the right real path is MCP and this connect flow
  hasn't been rebuilt for it yet, instead of the old "pending partner
  approval" framing, which is no longer accurate (nothing is pending
  anymore — the path itself changed).
- **Before building the real MCP integration**: get the support.coros.
  com Setup Guide's actual OAuth-for-custom-apps content (paste it, or
  screenshots, same as unblocked WHOOP's and Garmin's real specs this
  session) — specifically whether it really is discovery + DCR + PKCE
  with zero manual registration step, or whether there's a dashboard/
  client-ID step after all that the email's wording just didn't
  mention. Once connected for real, call `tools/list` immediately and
  store the raw response (same "capture now, parse later" discipline
  `garmin_push_events` already uses) before attempting to build a real
  `course` payload from Cadencia's own `WorkoutStep[]` model.

## COROS MCP: real OAuth + tool discovery built (Nov 2026)

Direct follow-up the same session: the user pasted the actual
support.coros.com article content (including its own link out to
oauth.net's standard OAuth 2.0 reference) and said plainly to use that —
confirming COROS really does speak plain, standards-based OAuth 2.0 with
no COROS-specific wrinkle, which combined with the official MCP
Authorization spec's documented shape was enough to build the real
connection, not just document the gap.

- **`lib/integrations/corosMcp.ts`** (new) replaces the old Partner-API
  scaffold (`lib/integrations/coros.ts`, now **deleted outright** —
  nothing imported it anymore once this landed, and this codebase's own
  practice is to delete confirmed-unused code rather than leave it as a
  zombie). Built on the official `@modelcontextprotocol/sdk` package
  (new dependency) — specifically its `client/auth.js` module's
  `discoverOAuthServerInfo()` (RFC 9728 + RFC 8414 metadata discovery),
  `registerClient()` (RFC 7591 Dynamic Client Registration),
  `startAuthorization()`/`exchangeAuthorization()`/
  `refreshAuthorization()` (PKCE authorization-code flow) — the SDK's
  own implementation of the spec, not hand-rolled, same confidence
  tier this codebase already gives "generic OAuth2 is safe to code."
- **No manual "create an app, get a Client ID" step exists for this
  integration**, unlike every other one in this app — DCR means
  Cadencia registers itself with COROS's authorization server
  automatically, the first time anyone ever connects, and the result
  (client_id, client_secret if any) is cached in a new singleton table,
  `coros_mcp_client` (`id boolean primary key check (id)`, a real
  Postgres single-row idiom), reused for every athlete's own connect
  afterward — registering a fresh client per athlete or per click would
  be wasteful and isn't what DCR is for. `coros_mcp_pkce` mirrors
  `garmin_oauth_pkce` exactly for the PKCE code_verifier's round trip.
  `coros_connections` (already existed from migration 014) gained
  `issuer`, `tools_catalog`, `tools_captured_at` — migration
  `033_coros_mcp.sql`, **needs this run in the Supabase SQL editor**.
- **`/api/coros/connect` and `/api/coros/callback` were rewritten**
  against this real flow — same shape every other integration's routes
  already have (derive the athlete from the session, redirect to the
  real authorize URL, exchange the code on callback, upsert
  `coros_connections`). `/api/coros/status` and `/api/coros/disconnect`
  needed **no changes at all** — they already just read/delete rows
  from `coros_connections` generically, which is exactly the table this
  rewrite kept using.
- **The moment a connection succeeds, `captureCorosToolCatalog()` calls
  the MCP protocol's own `tools/list`** and stores the raw result in
  `coros_connections.tools_catalog` — best-effort, never fails the
  connect itself. This is the single most useful property MCP has that
  no other integration in this codebase gets for free: every tool
  self-describes its real input schema over the wire, so once José
  actually connects for real, `tools_catalog` will hold the real,
  confirmed shape of `createScheduledWorkout`'s `course` parameter —
  no more doc-hunting needed for that specific piece.
- **`pushStructuredWorkoutToCorosMcp()` is deliberately NOT implemented
  — it always throws a clear "not built yet" error.** The `course`
  object's internal schema (how warmup/interval/recovery/cooldown
  sections and pace/HR/power targets are actually represented) is still
  not confirmed from any source this sandbox could reach; guessing it
  would repeat the exact mistake the old Partner-API `tp/list/push`
  scaffold already made. The "Push to COROS" button in `WorkoutDialog.tsx`
  is unchanged and still calls `/api/coros/push`, which now surfaces
  this honest error instead of silently failing against a wrong URL.
  Settings' COROS card copy was updated to say exactly this: real
  connection works, pushing doesn't yet.
- **Confirmed real, from COROS's own GitHub docs (`coroslab/COROS-MCP`,
  reached via `raw.githubusercontent.com` — `github.com` and
  `api.github.com` are both blocked from this sandbox, only that raw-
  content subdomain works)**: the MCP endpoint
  (`https://mcp.coros.com/mcp`, regional alternates for China/Europe/
  US documented but not wired in — add if an athlete's account turns
  out to need one), the real write tool names
  (`createTrainingPlan`/`updateTrainingPlan`,
  `createSingleWorkout`/`updateWorkoutDetails`, `scheduleWorkout`,
  `createScheduledWorkout`/`updateScheduledWorkout` — the last pair is
  the closest match to how `workouts` rows already work, one dated
  workout at a time), and the read tools (`queryTrainingPlanLibrary`,
  `queryTrainingSchedule`, `querySportRecords`, `getActivityDetail`,
  etc. — a real pull-sync feature, mirroring Strava/WHOOP's own "Sync
  now," is newly possible here and wasn't confirmed as existing at all
  under the old Partner-API framing; not built, just newly available).
- **Completely untested from this sandbox** — `mcp.coros.com` fails the
  egress proxy's CONNECT tunnel the same way `support.coros.com` does,
  so none of discovery, DCR, the authorize redirect, or the token
  exchange has ever actually run against COROS's real server from here.
  **Confirm the whole thing once deployed**: that `/api/coros/connect`
  redirects somewhere that looks like a real COROS login/consent screen
  (not an error), that the callback actually lands on `?coros=connected`
  with a real `coros_connections` row, and that `tools_catalog` ends up
  holding a real tool list after that — then read it to finally build
  `pushStructuredWorkoutToCorosMcp()` for real.
- **Confirmed live (Nov 2026): the real OAuth flow works end to end.**
  José connected for real — COROS's own authorize screen (a real
  "authorization" page asking for the COROS account email/password and
  listing the exact two scopes requested: personal info + workout data
  including routes) appeared, and `/settings` showed "Connected" after.
  This is the first live confirmation that the discovery + DCR + PKCE
  flow this file describes above actually works against COROS's real
  server, not just in theory.
- **"Push to COROS" still throws its "not built yet" error on a real,
  connected account — this is expected, not a bug** (reported live via
  a screenshot of exactly that message). `pushStructuredWorkoutToCorosMcp()`
  is deliberately unimplemented until the real `course` payload schema
  is read from `coros_connections.tools_catalog` — see this file's own
  header comment. **New debug surface added so that schema can actually
  be read without SQL Editor access**: `GET /api/coros/tools-catalog`
  (signed-in athlete only) returns the connected athlete's captured
  `tools_catalog`/`tools_captured_at`; `/settings`'s COROS card gained a
  "View captured schema" button (shown once connected) that fetches and
  pretty-prints it in a scrollable `<pre>` with a Copy button — this
  sandbox still can't reach `mcp.coros.com` itself, so reading the real
  schema and implementing the push function for real needs that JSON
  pasted back from a real connected account (José's, now that it's
  connected) rather than fetched here. If the panel says nothing was
  captured, disconnecting and reconnecting COROS re-runs
  `captureCorosToolCatalog()`.

## Community — Phase 1: roster, roles, open join (Nov 2026)

A real, deliberately big feature, confirmed before building via
`AskUserQuestion` on three pivotal forks (guessing any of them wrong
would have meant real rework): **multiple separate communities** (not
one shared pool — a coach creates their own group, e.g. a running club
or a triathlon community, and members only belong to the ones they
joined) is a "Recomendado," **a coach can create communities AND
bulk-assign one workout to every member at once** (also "Recomendado" —
the bulk-assign part is NOT built yet, phase 2), and **build in
phases** — this pass is the base (header redesign, data model,
create/join/leave, roster) with compare-profiles and aggregate
community stats (described as needing to be "súper dinámico, súper
métricas, súper bien coloridas... gráficos súper bien hechos") held for
a dedicated follow-up pass so each piece gets built properly rather
than everything half-done in one shot.

- **This is the first real privacy boundary of any kind in this app.**
  Every table before `communities`/`community_members` is fully open to
  any authenticated athlete (the "shared coach log" model documented
  throughout this file) — that doesn't change for
  `workouts`/`templates`/Strava-etc. data, which stays exactly as open
  as before. Communities are a new, separate layer on top: anyone
  signed in can browse the full directory (needed to discover and join
  one), but membership itself, and anything built on membership later
  (compare/aggregate stats), is scoped to who's actually in a given
  community.
- **Migration `034_communities.sql`** (mirrored in `schema.sql` —
  **needs this migration run in the Supabase SQL editor**):
  `athletes.is_coach` (a plain, **self-editable** boolean — unlike
  `is_admin`, which only the service-role client can ever touch via the
  `athletes_guard_is_admin` trigger, `is_coach` is just a preference an
  athlete can flip on their own row through the existing
  `athletes_update_own` RLS policy, same as their name or thresholds).
  `communities` (id, slug, name, description, `created_by`, `created_at`
  — `created_by` is nullable with `on delete set null` since this app
  has no "delete an athlete" feature yet, but a community shouldn't
  vanish if one is ever added) and `community_members` (a plain join,
  `(community_id, athlete_id)` primary key, no per-membership role
  column — "the coach of this community" is just
  `communities.created_by`).
- **Creating/joining/leaving a community is entirely RLS-governed, no
  new API routes at all** — consistent with how `workouts`/`templates`
  are already directly browser-writable in this app, not routed through
  a server endpoint. `communities`' insert policy checks
  `created_by = <caller's own athlete id> AND (is_coach OR is_admin)`
  directly in SQL; `community_members`' insert/delete policies just
  check `athlete_id = <caller's own athlete id>` — any athlete can join
  or leave any community with no approval step, the exact same
  "automático, sin solicitud" philosophy already confirmed for the
  Friends picker (see "Real auth + admin" above).
- **`/community`** (`app/community/page.tsx`): "My communities" (if
  any) + "All communities" directory, each card showing name,
  description, member count, the coach's name, and a Join/Leave button
  — member counts come from one flat `community_members` select
  reduced client-side (no RPC/group-by needed at this scale). A "+
  Create a community" button appears only for `is_coach || is_admin`,
  opening an inline name+description form; the slug is generated
  client-side with the same `slugify()`/`dedupeSlug()` helpers
  `lib/athleteSlug.ts` already exports for athlete slugs (now shared,
  not athlete-specific).
- **`/community/[slug]`** (`app/community/[slug]/page.tsx`): one
  community's full roster (initials avatar + name per member, the
  coach labeled), Join/Leave. Deliberately **not membership-gated for
  viewing** in this pass — any signed-in athlete can look at any
  community's roster, even one they haven't joined, since over-
  restricting now without being explicitly asked risked guessing wrong;
  the compare/aggregate-stats follow-up is where real membership-only
  gating will matter and get built deliberately then.
- **Header redesign** (`SiteHeader.tsx`), direct feedback: "no me
  encanta... debería salir como el perfil del usuario, más no... mi
  nombre ahí arriba. A la derecha arriba pondría el perfil del
  usuario... pondría también un... tab que diga community." The old
  plain, non-clickable `{me.name}` pill that sat top-left next to
  Friends is gone — replaced by a clickable profile chip (initials
  avatar + name, linking to `/settings`, which already owns the full
  profile editor — no second profile page was built) moved to the
  right side, next to the segmented Calendar/Community/Generate/
  Settings nav group and the Admin pill (still rightmost). "Community"
  was added to `NAV` right after Calendar, kept literally "Community"
  in both locales (not translated), the same "this is the feature's
  actual name" treatment "Generate" already got.
- **Onboarding question**: `/accept-invite`'s password-setup form (the
  admin-invite path) now also asks "Are you a coach or an athlete?"
  (a two-option toggle, defaulting to Athlete) right before the submit
  button — direct request: "cuando estás creando el account... te
  pregunte si eres coach o eres solamente atleta." Saved as a
  best-effort `athletes.is_coach` update right after the password is
  set (never blocks finishing signup if it fails) — **Google
  self-registration (`ensureAthleteForUser()`) has no UI step at all**,
  so a Google sign-up always starts as `is_coach: false` (the column's
  own default) and can flip it from the Athlete Profile card on
  `/settings` afterward, same as anyone else who wants to change their
  role later. `AthleteProfileCard.tsx` gained a small "Role" section
  (a labeled checkbox, "I'm a coach") right after Personal Info, wired
  into the same single-Save flow every other profile field already
  uses.
- **`/admin`** gained a "Coach" badge + a "Make coach"/"Remove coach"
  button per athlete row, mirroring the existing Admin badge/toggle —
  purely a convenience for an admin to set someone else's role on their
  behalf (e.g. a Google-registered athlete who hasn't touched Settings
  yet), not a new trust boundary: `PATCH /api/admin/athletes/[id]` now
  also accepts an optional `isCoach` alongside the existing `isAdmin`, written directly
  (no last-admin-style guard, no trigger — `is_coach` was never
  security-sensitive to begin with).
- **Explicitly NOT built in this pass** (confirmed deferred, per the
  build-order decision above): comparing two athletes' profiles
  side-by-side, community-wide aggregate stats (total km as a
  community, etc.), and the bulk-assign-a-workout-to-every-member
  feature that's the other half of what "coach" is supposed to unlock.
  All three need their own real design pass (what metrics, what time
  window, what the comparison view actually looks like) rather than a
  rushed addition here — tracked as the explicit next phase of this
  feature, not forgotten scope.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: run migration 034, that a coach can
  actually create a community (and a plain athlete's attempt is
  correctly rejected by the RLS policy, not just hidden by the UI),
  that join/leave actually persist, and that the accept-invite
  coach/athlete choice actually lands on the right row.

## Community — Phase 2: compare profiles, aggregate stats, bulk-assign (Nov 2026)

The three pieces explicitly deferred from Phase 1 above, confirmed to
proceed with per the user's own direct message ("comparar dos perfiles
lado a lado, estadísticas agregadas de la comunidad... y que un coach
pueda asignar un mismo entreno a toda la comunidad de una vez... esas
tres merecen su propio diseño con calma... procedamos"). All three
reuse existing pure helpers and RLS-open tables — no new migration, no
new API route, same "direct Supabase client call from the page" pattern
every other Community/Friends write already uses in this app.

- **Compare profiles** (`/community/[slug]/compare?with=<athleteId>`,
  `components/CompareProfiles.tsx`): defaults the left side to the
  signed-in athlete; with no `?with=`, the page shows a picker of the
  community's other members instead of guessing a second athlete. A
  "Head to head" radar chart (`lib/compareMetrics.ts`'s
  `buildCompareAxes()`) only includes an axis — weekly volume (last 30
  days of synced Strava activity ÷ ~4.3 weeks), VO2max (device-measured
  preferred, falls back to the manually-entered value), FTP, 5K speed
  (derived from `predictRaceTimes()`'s own Riegel projection, inverted
  to km/h so "higher is better" matches every other axis), resting HR
  (inverted via a fixed 100bpm reference) — when **both** athletes have
  a real value for it; a missing metric is left out entirely rather than
  zeroed, since zeroing would unfairly make someone who simply hasn't
  filled in e.g. FTP look like they have none. Each axis is normalized
  independently against its own two values (whichever athlete is ahead
  reaches the outer ring) — this chart answers "who's ahead on this
  axis," not "how far from some absolute max," which is the more honest
  reading for a head-to-head. Below the radar: a diverging per-sport bar
  comparison (last 30 days of distance, one bar growing from center
  each direction, sport-colored labels), a zones/thresholds comparison
  (LTHR, threshold pace, FTP, VO2max — paired bars, the better value
  bolded and outlined), a race-predictor table (5K/10K/Half/Marathon,
  labeled "actual" vs. estimated same as `/settings` already does), and
  — only when both athletes have WHOOP history — a side-by-side
  Fitness/Fatigue/Form reading with a mini CTL sparkline each, reusing
  `lib/fitnessForm.ts`'s `computeFitnessForm()` unmodified (the page
  fetches each athlete's own `whoop_cycles` directly, same query shape
  `FitnessPanel.tsx` already uses). The whole page uses one fixed pastel
  color pair (`--bike` for the left athlete, `--gym` for the right) for
  every chart element on the page, not either athlete's own sport mix —
  a consistent "A vs B" visual language across the radar, bars, and
  zone comparisons.
- **Husmear (view-only profile)**
  (`/community/[slug]/member/[athleteId]`,
  new page): a read-only slice of `AthleteProfileCard`/`ZoneTables`/
  `StravaTotals` — goal race, resting/max HR, VO2max, height/weight,
  personal bests, the race predictor table, zones, and Strava totals —
  with no edit controls, since this is someone else's data. Not
  membership-gated for viewing, same choice Phase 1 made for the roster
  itself. Has its own "Compare" button that jumps straight into the
  compare view against this athlete.
- **Aggregate community stats** (`lib/communityStats.ts`'s
  `computeCommunityStats()`, a pure function, plus a new stats section
  on `/community/[slug]` above the roster): sums every community
  member's synced Strava activity — whatever window `strava_activities`
  already covers (last 30 days, same as everywhere else in this app
  that reads this table, see the "no necesito lo histórico" note under
  Strava integration above) — into a total distance/time/session-count
  KPI row, a per-sport breakdown (reusing the same sport-accent-colored
  bar pattern `DashboardPanel.tsx`'s own "By sport" card already uses),
  and a leaderboard (members ranked by distance, each a bar against the
  group's own max). Real Strava data only — a community where nobody's
  synced anything shows an honest "no synced activity yet" message, not
  a chart full of zeros pretending to be real.
- **Coach bulk-assign** (`components/AssignCommunityWorkoutDialog.tsx`,
  an "Assign workout to everyone" button on `/community/[slug]` shown
  only when the signed-in athlete is this community's coach
  (`created_by`) or an admin): sport/title/date/minutes/km/notes, no
  structured-steps editor — deliberately simpler than `WorkoutDialog`,
  since the per-step HR/pace/power zone quick-pick resolves against ONE
  athlete's own thresholds and wouldn't make sense applied blindly
  across a roster of athletes with different zones; each athlete can
  add their own structure afterward from their own calendar like any
  other workout. On submit, batch-inserts one plain `workouts` row
  (`done: false`) per community member directly via the browser
  Supabase client (`workouts` is already open to any `authenticated`
  write, same "shared coach log" model documented at the top of this
  file) — no new API route, no new RLS policy.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: that the radar/bar/zone comparisons
  render sensibly for two real athletes with genuinely different data
  completeness (one with WHOOP connected and one without, one with a
  5K PB and one without), that the leaderboard and per-sport totals on
  the roster page match what Strava itself shows for those athletes,
  and that "Assign workout to everyone" actually lands one row per
  member and that a non-coach/non-admin athlete never even sees the
  button (RLS doesn't need to block this one — `workouts` has always
  allowed any authenticated athlete to write any other athlete's row,
  so this button is a UI convenience, not a new permission boundary).

## Style

Bilingual ES/EN throughout (`src/lib/i18n/context.tsx`), same pattern as
the Operations Hub's forms — a flat `t(key)` lookup, not nested namespaces,
to keep every page's strings in one place. No em dash (`—`) in any
user-facing string, matching the Operations Hub's own style rule — fine in
this file and in code comments, never in UI copy.

## Public home / self-registration page (Nov 2026)

Direct request, from the same session that surfaced the Supabase email
rate-limit/SMTP issues above: "Quiero una pagina de incio para
registrarse a cadencia." Two forks confirmed via `AskUserQuestion`
before building, since guessing either wrong meant real rework:

1. **Registration method, confirmed answer**: "deja lo de google, pero
   no le conectemos aún. pon un mensaje de que esta función aún no esta
   habilitada. Crear contraseña y poner el mail, así simple" — plain
   email+password self-registration is the ACTIVE method (no invite
   needed, same open philosophy Google sign-in already has); the
   Google button is shown but deliberately disabled with a "not
   available yet" note. This is scoped to only this new page's own
   button — the already-built, fully-wired Google OAuth flow on the
   gated sign-in screen (`SignInScreen` in `auth-context.tsx`) is
   completely unchanged.
2. **Location, confirmed answer**: "Página pública nueva y separada" —
   a real public page, not a redesign of the existing gated sign-in
   screen. Lives at `/` (the literal "home page"), replacing this
   app's old `redirect("/calendar")` root page.

- **`app/page.tsx`**: on mount, checks for an existing session and
  redirects to `/calendar` if one exists (so a returning signed-in
  visitor isn't shown a registration form); otherwise shows the
  welcome copy + disabled Google button + email/password/confirm form.
  Submits via `supabase.auth.signUp()` and handles both real outcomes:
  an immediate `data.session` (Supabase's "Confirm email" setting is
  off) calls the new `POST /api/auth/ensure-athlete` then routes into
  `/settings`; no immediate session (confirmation required) shows a
  "check your email" message instead. A link at the bottom routes an
  already-registered visitor to `/calendar`, which shows the existing
  gated sign-in screen (email/password sign-in, the real Google
  button, "Forgot your password?") — unchanged.
- **`api/auth/ensure-athlete/route.ts`** (new): reads the caller's own
  session server-side, then calls `lib/ensureAthlete.ts`'s
  `ensureAthleteForUser()` — the exact same idempotent athlete-row-
  creation logic Google's self-registration already uses (checks for
  an existing row by `auth_user_id` or email first, creates one if
  not, name falls back to the email's local part since this form
  collects no name field). Reused rather than duplicated, so a new
  athlete's row looks identical regardless of which self-registration
  path created it.
- **`lib/auth-context.tsx`**: `PUBLIC_PATHS` deliberately does NOT
  include `"/"` — that list is matched by `pathname.startsWith(p)`,
  and `"/".startsWith("/")` would match literally every path in the
  app, defeating the whole auth gate. `isPublicPath` now checks
  `pathname === "/" || PUBLIC_PATHS.some(...)` instead — root is
  matched exactly, every other public path still by prefix.
- **Strongly recommended, not yet confirmed done**: turn OFF
  Supabase's "Confirm email" setting (Auth -> Providers -> Email ->
  Confirm email) for this project. With it off, `signUp()` returns a
  session immediately and self-registration needs **zero** Supabase
  emails at all — directly avoiding the "email rate limit exceeded" /
  "invalid or expired" problems documented above, which was the whole
  reason this page exists in the first place ("seguimos usando los
  mails de supabase," i.e. no custom SMTP domain was set up either).
  With it left on, `signUp()`'s confirmation email would need the same
  `token_hash`-pattern email-template fix already documented for
  Invite/Reset Password, applied a third time to "Confirm signup" (not
  done) — and the confirmation link lands on `/accept-invite`, which
  will ask the new user to set a password again (harmless redundancy,
  not a broken flow, just not polished) since that page's own flow was
  built for the invite case, not a user who already picked one at
  signup.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: that a brand-new email+password
  registration actually works end to end (ideally with "Confirm
  email" off, per the recommendation above), that the resulting
  `athletes` row looks correct, and that an already-registered
  visitor hitting `/` gets redirected straight to `/calendar` instead
  of seeing the registration form again.

### Real marketing landing page, registration form moved to `/register` (Nov 2026)

Immediate direct follow-up: "quiero antes de entrar ahí que haya una
landing page explicativa. te comparto unas imagenes para que te guies
en la info y lo que tenemos que poner. siguiendo nuestro manual de
marca." Five reference screenshots were shared (FinalSurge, Intervals.icu,
TrainingPeaks) — explicitly for content/structure (hero + subheadline +
CTAs, a "connects with" integrations strip, athlete-facing vs.
coach-facing feature sections, a closing CTA band), not visual style:
this page is built entirely from Cadencia's own existing design tokens
(monochrome ink/surface/line, IBM Plex Sans + JetBrains Mono wordmark,
pill buttons, rounded-2xl cards), never FinalSurge's red or
Intervals.icu's indigo.

- **`app/page.tsx`** is now a real marketing page, not the registration
  form — header (logo + "Log In"/"Sign Up"), a hero (headline,
  subheadline, two CTA buttons, a "Connects with" strip), two
  `FeatureSection`s ("For athletes" / "For coaches," each with real
  bullet points pulled from this app's actual built features — no
  invented claims), a closing dark CTA band, and a minimal footer.
  The two `*Mock` components (`CalendarMock`, `LeaderboardMock`) are
  decorative but genuine — built from this app's own real `.s-<sport>`
  calendar-chip color pattern and the Compare feature's own fixed
  bike/gym color pair, not a fabricated screenshot.
- **Deliberately NOT borrowed from Intervals.icu**: its usage-stats row
  ("200,000+ Active Athletes," "300M+ Activities Analyzed," etc.) —
  this app has no real users to report, and making up a number here
  would be exactly the kind of overclaiming this codebase avoids
  everywhere else (see the "never fabricate" rule already documented
  repeatedly in this file — Best Efforts, Fitness/Fatigue/Form, etc).
- **"Connects with" strip lists Strava, WHOOP, Garmin, COROS** as
  plain bold text wordmarks (no logo images — this app has no real
  brand-asset files for any of them, and text fits this app's
  restrained monochrome brand better than borrowed color logos would
  anyway). All four genuinely have a working connect flow in this app
  today, which is the bar for being listed here — even though COROS's
  actual structured-workout push isn't built yet (see its own CLAUDE.md
  section), the OAuth connection itself is real and confirmed live.
- **The actual registration form moved to `app/register/page.tsx`**
  (relocated from `/`, same logic unchanged — see the section above
  for the full behavior) — the landing page's "Sign Up"/"Get Started"
  buttons, and the register page's own "Already have an account? Sign
  in" link, tie the two pages together. `/register` was added to
  `lib/auth-context.tsx`'s `PUBLIC_PATHS` (a normal prefix-matched
  entry, unlike `/` itself which still needs its own exact-match
  check — see that file's own comment on why).
- `layout.tsx`'s `<meta name="description">` was also updated in the
  same pass (direct request, reported via a WhatsApp link-preview
  screenshot showing the stale copy) from the original "Training log
  for Juan and José" — no longer accurate once registration opened up
  beyond just the two of them — to a generic description matching
  this new landing page's own pitch.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: that `/` renders correctly on mobile
  (the two `FeatureSection`s stack, the hero CTAs wrap cleanly), and
  that both CTAs ("Get Started" -> `/register`, "Log In" -> `/calendar`)
  land where expected.

### Branded Supabase email templates, a direct "set password" admin action, and the gated sign-in screen's stale link fixed (Nov 2026)

Same session's live testing with Juan kept surfacing the same root
cause from a few more angles — Supabase's auth emails (Confirm signup,
Invite user, Reset Password) were still unbranded and, independently,
still not reliably reaching him even after Resend was wired up as
custom SMTP (reusing the already-verified `axiskey.com` domain from
the Operations Hub codebase, since the user explicitly declined buying
a dedicated domain earlier — "no quiero dominio... usemos el mismo
mail de resend axiskey.com"). Three concrete pieces came out of this:

- **All three Supabase email templates got Cadencia-branded HTML**
  (dark header, the `cadencia` wordmark, a black pill CTA button
  matching this app's own `Button` component, the already-decided
  `token_hash` link pattern baked directly into each one) — handed to
  the user to paste into Auth -> Email Templates' Subject/Source
  fields for Confirm signup / Invite user / Reset Password. **The
  first version referenced the real hosted logo
  (`https://cadenciatraining.vercel.app/logo.png`) and it rendered as
  a broken-image icon in Supabase's own template preview** — the file
  itself was confirmed intact (a real 300x300 PNG, not corrupted, same
  verification discipline the Operations Hub codebase's own broken-
  email-logo saga established) so this was either Supabase's preview
  sandbox not fetching external images, or a prod/preview deployment
  mismatch, neither confirmable from this sandbox. Rather than debug
  an unconfirmable cause, the templates were rewritten to drop the
  image entirely and use the exact same text-only wordmark treatment
  (`cadencia` + `TRAINING LOG` tagline, no icon) the in-app sign-in
  screen and `/register` already use — zero risk of ever showing a
  broken-image icon in any client, not just a Supabase preview quirk.
- **`POST /api/admin/athletes/[id]/set-password`** (new): lets an
  admin set an athlete's password directly from `/admin`, with **no
  Supabase email involved at all** — built specifically to unblock
  Juan after repeated real email-delivery failures this same session
  (direct request: "creame un usuario para juan, con clave genérica...
  que haga login"). Handles both shapes an athlete can be in: already
  has a linked `auth_user_id` (overwrites that account's password via
  `auth.admin.updateUserById()`, and force-sets `email_confirm: true`
  too, so a never-confirmed account becomes usable in the same call),
  or has no account yet (`auth.admin.createUser()` using the athlete's
  own stored email, then links the new user's id onto the `athletes`
  row — same linking the existing invite flow already does). The
  `/admin` UI's new "Set password" button opens an inline field
  pre-filled with a generic placeholder password (`Cadencia2026!`,
  editable) and shows a one-line reminder of the exact email/password
  pair to hand the athlete once saved, since this is the one time that
  password is visible anywhere.
- **The gated sign-in screen's footer link was stale and fixed**
  (`SignInScreen` in `auth-context.tsx`, found live from a screenshot:
  "falta un sign in link para cambiar y crear cuenta") — it still read
  "New here? Sign in with Google and your account is created
  automatically," left over from before `/register`'s plain
  email+password self-registration became the active method (Google is
  now deliberately disabled on that page — see its own section above).
  Replaced with a real link, "Create an account" -> `/register`, so
  someone who lands directly on the gated sign-in screen (e.g. by
  visiting `/calendar` with no session) has a way to reach
  registration too, not just visitors who start at `/`.

### First-run onboarding wizard (Nov 2026)

Direct, verbatim instruction right after self-registration shipped:
"cuando entro debería hacerme llenar todo el perfil de como encuesta y
pedirme que me conecte con los diferentes apis. eso es lo primero que
tiene que hacer. esfuérzate más." A brand-new account of ANY kind —
self-registered via `/register`, Google, or admin-invited via
`/accept-invite` — now gets forced through a two-step onboarding wizard
before it can see anything else in the app.

- **Migration `035_onboarding_flow.sql`** (mirrored in `schema.sql` —
  **needs this migration run in the Supabase SQL editor**):
  `athletes.onboarding_completed`, default `false` so every future
  insert needs onboarding, immediately backfilled to `true` on every
  row that already existed when the column was added — Juan and José
  are already using the app and shouldn't suddenly be interrupted by a
  first-run wizard that predates their accounts.
- **`components/settings/ConnectionCards.tsx`** (new): the zones card
  and all 5 connection cards (Strava, WHOOP, Garmin Developer, Garmin
  Personal, COROS) were extracted out of `/settings`'s own page file
  into this shared component, specifically so the new wizard and
  `/settings` share one real implementation instead of two copies of
  six cards' worth of fetch/connect/disconnect logic drifting apart
  over time. `/settings` itself is otherwise unchanged — same content,
  same layout, just importing instead of defining these locally.
- **`app/onboarding/page.tsx`** (new): two steps, a simple dot-stepper
  at the top.
  1. **Profile** — `AthleteProfileCard` + `AthleteZonesCard`,
     unmodified, the exact same components `/settings` already uses.
     Deliberately **not skippable** — filling this in needs nothing
     external, and the user asked for "todo el perfil" directly, not
     an abbreviated version.
  2. **Connections** — the same 5 cards `/settings` shows, in the same
     grid. **Has a "Skip for now" option** (alongside "Finish," both
     call the same completion handler) — connecting a real external
     account isn't something this app can force if the athlete
     doesn't have one yet; skipping still marks onboarding complete so
     it doesn't nag forever, and everything here stays editable from
     `/settings` any time afterward.
  "Finish"/"Skip" both just set `athletes.onboarding_completed = true`
  for the signed-in athlete directly (same open-write-to-your-own-row
  pattern every other profile field already uses) and route to
  `/calendar`.
- **`lib/auth-context.tsx`**: once `me` resolves, `needsOnboarding` is
  `true` whenever `!me.onboarding_completed` and the current path
  isn't `/onboarding` itself — an effect redirects there
  (`router.replace`), and the render path shows a blank loading state
  for that one tick instead of flashing the real destination page's
  content first. Deliberately **no other exempt path** (not even
  `/settings`, which has the identical content) — per the user's own
  "esto es lo primero que tiene que hacer," so there's no loophole
  page a not-yet-onboarded athlete could bookmark to permanently dodge
  the wizard.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: run migration 035, that a genuinely
  brand-new account (via `/register`, Google, or an admin invite)
  actually lands on `/onboarding` and can't navigate around it, that
  "Skip for now" and "Finish" both correctly release the gate, and
  that Juan/José's existing accounts were NOT interrupted by this
  (their rows should already read `onboarding_completed = true` right
  after the migration runs).

### Gated sign-in screen's Google button also disabled (Nov 2026)

Found live from a real screenshot: clicking "Continue with Google" on
the gated sign-in screen (the one shown for any visitor without a
session, e.g. at `/calendar`) navigated the whole page away to
Supabase's own raw authorize endpoint, which returned its own
unbranded `{"code":400,"error_code":"validation_failed","msg":
"Unsupported provider: provider is not enabled"}` JSON — proof Google
was never actually enabled in Supabase's own Auth providers, contrary
to this file's earlier assumption that this particular button was
"already fully wired." Because `signInWithOAuth` triggers a full
top-level navigation away from the app, there's no way to catch that
failure and show a nice in-app message after the fact once it's
already happened — the only honest fix is not starting it at all.
`SignInScreen`'s Google button now gets the exact same disabled-with-
a-note treatment `/register`'s own Google button already has
("Continue with Google (not available yet)"), and `handleGoogleSignIn`
no longer calls `signInWithOAuth`. Flip this back to a real call once
Google is confirmed enabled in Supabase Auth -> Providers -> Google
(see CLAUDE.md's "Google sign-in" section for the two manual setup
steps that were apparently never actually completed).

### Onboarding gate hardened: no page (or its nav) renders until the athlete row actually resolves (Nov 2026)

Found live from a real screenshot right after the wizard above shipped:
`/settings` sat on an infinite "Loading…" — and the header's full nav
(Calendar/Community/Generate/Settings) stayed visible and clickable the
whole time, since `SiteHeader` has never checked onboarding state at
all. Direct, verbatim follow-up: "que no te deje aplastar en calendar,
community o generate. que sea obligatorio registrar la encuesta para
entrar a la plataforma."

Root cause of both: `needsOnboarding` (and therefore the redirect to
`/onboarding`) only ever evaluated once `me` resolved — but if a
signed-in session's `athletes` row genuinely never resolves (the real
bug underneath the stuck "Loading…"), `me` stays `null` forever,
`needsOnboarding` never becomes `true`, and the old code fell through
to rendering `children` anyway — the real page (with its own full
`SiteHeader` nav) rather than being held back by anything.

- **`AuthProvider`** now tracks `athletesLoaded` separately from
  `athletes.length > 0`, set once the `athletes` fetch actually
  finishes (success OR failure — the error is now `console.error`'d
  too, previously silently swallowed). The render path is now a strict
  sequence with no way to skip a step: blank screen while
  `!athletesLoaded` -> a real, non-skippable `NoProfileScreen` (new)
  if the fetch finished but still found no matching `athletes` row at
  all (session + no profile = a genuine problem, not something to hide
  behind an infinite spinner) -> blank screen while `needsOnboarding`
  (same as before) -> only then `children`. **No branch in this chain
  ever renders `children` (and therefore never renders `SiteHeader`'s
  nav) until an athlete row is both found AND onboarded** — closing
  the exact gap that let the header stay clickable while stuck.
- **`NoProfileScreen`**: a dead-end-feeling but honest screen ("We
  couldn't find a profile linked to your account") with a Sign Out
  button as the one real recourse — covers a partially-failed
  self-registration (e.g. `ensure-athlete` never completing) or any
  other case where a real `auth.users` row exists with no matching
  `athletes` row, instead of leaving the person on a page that will
  never finish loading with no way out except closing the tab.
- A Google-Fonts build failure was also hit twice this same session on
  Vercel (`next/font/google` fetches IBM Plex Sans/JetBrains Mono at
  **build** time, and that fetch failed) — confirmed as a genuine
  transient network blip, not a real problem: rebuilding locally with
  a clean `.next` cache succeeded immediately after. Not worth
  switching to self-hosted fonts (`next/font/local`) over one-off
  flakiness; revisit only if it starts failing more than rarely.
- Not yet tested against a real Supabase project from this sandbox
  (same standing limitation as every other Supabase-dependent feature
  here) — confirm once deployed: that a genuinely broken account (no
  matching `athletes` row) now shows `NoProfileScreen` instead of a
  silent infinite spinner, and that clicking Calendar/Community/
  Generate while onboarding isn't done bounces straight back to
  `/onboarding` with no flash of the target page's own nav/content.
