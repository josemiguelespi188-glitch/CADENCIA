-- Three real product gaps found live (Nov 2026), from direct feedback
-- after testing the just-seeded Base Workouts presets:
--
-- 1. "no entiendo de qué sirve el Base Workouts si es que no hay cómo
--    añadir al calendario" -- there was no way to pick a preset when
--    adding a workout (the only existing picker was a small <select>
--    buried inside WorkoutDialog, shown only for a brand-new workout).
--    Addressed in app code (NewWorkoutLauncher's new "Search for
--    Workouts" entry point) -- no schema change needed for that part.
-- 2. "no hace constancia el idioma de los Base Workouts con el idioma
--    en el cual está la plataforma" -- the seeded presets are plain
--    Spanish text with no connection to the EN/ES toggle. Fixed by
--    adding optional English companion columns (title_en/notes_en),
--    read by lib/templates.ts's templateTitle()/templateNotes() —
--    falls back to the Spanish text when the English one is blank,
--    never a blank field.
-- 3. "Los entrenamientos que son bricks deberían estar marcados no
--    como bike, sino como bike and run" -- confirmed via
--    AskUserQuestion to add a real 6th sport ("brick"), not just a
--    cosmetic label, since the user explicitly wants it to carry its
--    own identity (color/icon) across the app, the same way the
--    other five sports do.

alter table templates add column if not exists title_en text;
alter table templates add column if not exists notes_en text;

-- Widen both sport check constraints to allow 'brick' — looked up by
-- name dynamically rather than a guessed "<table>_sport_check" literal,
-- since neither constraint has ever been touched/renamed by a prior
-- migration and a wrong guess would silently no-op instead of erroring.
do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass::text as tbl
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.contype = 'c'
      and att.attname = 'sport'
      and con.conrelid::regclass::text in ('workouts', 'templates')
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table workouts add constraint workouts_sport_check
  check (sport in ('swim', 'bike', 'run', 'gym', 'race', 'brick'));
alter table templates add constraint templates_sport_check
  check (sport in ('swim', 'bike', 'run', 'gym', 'race', 'brick'));

-- Re-tag the one brick preset seeded by migration 031 (it went in as
-- 'bike' since 'brick' didn't exist as a valid sport yet) and give the
-- 20 presets from that migration their English text, matched by title
-- (same idempotent-by-title approach 031 used, so this is safe to
-- re-run).
update templates set sport = 'brick' where title = 'Brick bici-carrera';

update templates set title_en = 'Long run', notes_en =
  'Goal: build endurance and aerobic base. Warmup: 15 min jog. Main set: 80-100 min in Zone 2. Cooldown: 10 min jog.'
  where title = 'Carrera larga';
update templates set title_en = 'Tempo run', notes_en =
  'Goal: improve aerobic strength and pace control. Warmup: 15 min jog. Main set: 35 min in Zone 3. Cooldown: 10 min jog.'
  where title = 'Carrera de ritmo';
update templates set title_en = 'Threshold intervals', notes_en =
  'Goal: raise your sustainable speed. Warmup: 15 min jog. Main set: 4 x 8 min in Zone 4 (2 min jog recovery between reps). Cooldown: 10 min jog.'
  where title = 'Intervalos de umbral';
update templates set title_en = 'Easy run', notes_en =
  'Goal: promote aerobic recovery and keep volume steady. Warmup: 5 min jog. Main set: 40 min in Zone 1-2. Cooldown: 5 min jog.'
  where title = 'Carrera fácil';
update templates set title_en = 'Progression run', notes_en =
  'Goal: teach control and finish strong. Warmup: 15 min jog. Main set: 15 min Zone 2, 15 min Zone 3, 5 min Zone 4. Cooldown: 10 min jog.'
  where title = 'Carrera de progresión';
update templates set title_en = 'Race-pace efforts', notes_en =
  'Goal: practice race pace and pacing control. Warmup: 15 min jog. Main set: 2 x 4 km at Ironman 70.3 goal race pace (4 min jog recovery between reps). Cooldown: 10 min jog.'
  where title = 'Esfuerzos de ritmo de carrera';
update templates set title_en = 'VO2 Max repeats', notes_en =
  'Goal: raise your aerobic ceiling and speed. Warmup: 15 min jog + strides. Main set: 5 x 3 min in Zone 5 (3 min jog recovery between reps). Cooldown: 10 min jog.'
  where title = 'Repeticiones de VO2 Max';
update templates set title_en = 'Broken tempo set', notes_en =
  'Goal: make tempo work more repeatable and digestible. Warmup: 15 min jog. Main set: 3 x 10 min in Zone 3 (2 min jog recovery between reps). Cooldown: 10 min jog.'
  where title = 'Conjunto de ritmo roto';
update templates set title_en = 'Fast-finish long run', notes_en =
  'Goal: practice pacing and strong finishes. Warmup: 10 min jog. Main set: 50 min in Zone 2, 15 min in Zone 3. Cooldown: 10 min jog.'
  where title = 'Final rápido, carrera larga';
update templates set title_en = 'Recovery run', notes_en =
  'Goal: stay relaxed and support adaptation. Warmup: 5 min jog. Main set: 30 min in Zone 1. Cooldown: 5 min jog.'
  where title = 'Carrera de recuperación';
update templates set title_en = 'Technique swim', notes_en =
  'A technique-focused session, not a speed one. Warmup: 300 m in Zone 1 (freestyle and backstroke). Main set: 5 x (25 m kick, 50 m drill, 75 m swim) in Zone 1 + 20 s rest. Cooldown: 150 m pull or swim in Zone 1. Focus on catch and arm recovery.'
  where title = 'Natación técnica';
update templates set title_en = 'Continuous swim', notes_en =
  'Goal: aerobic endurance in the water. Warmup: 300 m in Zone 1 (with some backstroke). Block: 2 x 50 m kick in Zone 1 + 10 s. Main set: 6 x 200 m swim or pull in Zone 2 + 20 s. Cooldown: 200 m in Zone 1. Count strokes every third 50 m length to track your technique.'
  where title = 'Natación continua';
update templates set title_en = 'Race-pace swim', notes_en =
  'Goal: practice goal race pace. Warmup: 200 m in Zone 1 (freestyle and backstroke). Block: 2 x 50 m technique in Zone 1 + 10 s. Block: 4 x 50 m building Zone 1-Zone 4 + 15 s. Main set: 5 x 300 m in Zone 3 + 30 s, aiming for your goal race pace. Cooldown: 200 m in Zone 1.'
  where title = 'Natación a ritmo de carrera';
update templates set title_en = 'Open-water swim', notes_en =
  'Goal: get comfortable in open water before race day. Warmup: 5 min in Zone 1. Main set: 3 x 8 min in Zone 2 breathing bilaterally, with 2 min recovery between reps. Cooldown: 5 min in Zone 1 with easy kick and swim.'
  where title = 'Natación en aguas abiertas';
update templates set title_en = 'Progressive swim', notes_en =
  'Goal: build speed while holding technique as intensity rises. Warmup: 3 x 100 m in Zone 1 + 10 s (mix of kick, pull and swim). Main set: 800 m in Zone 2 + 60 s, 600 m in Zone 3 + 40 s, 400 m in Zone 4. Cooldown: 300 m in Zone 1 (freestyle and backstroke).'
  where title = 'Natación progresiva';
update templates set title_en = 'Easy spin', notes_en =
  'Goal: easy aerobic ride with no accumulated fatigue. Block: 5 min in Zone 1 at 90 rpm. Block: 5 min in Zone 1 at 80 rpm. Main set: 55 min in Zone 1 at 90-95 rpm. Cooldown: 5 min very easy. Road or trainer, either works.'
  where title = 'Bicicleta suave';
update templates set title_en = 'Hill repeats', notes_en =
  'Goal: climbing strength and endurance. Repeat 3 times: 30 min in Zone 1 at 90 rpm + 20 min in Zone 2 at 75 rpm. Ride hilly terrain, stay seated on the climbs, pedal smoothly to minimize dead spots.'
  where title = 'Bicicleta con cuestas';
update templates set title_en = 'Time trial test', notes_en =
  'Goal: measure your progress against the clock. Warmup: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1. Main set: 16 km time trial at your best effort, noting time and heart rate. Cooldown: 10 min in Zone 1. Always use the same course so you can compare.'
  where title = 'Bicicleta de prueba (TT)';
update templates set title_en = 'Strong intervals', notes_en =
  'Goal: raise your capacity to process oxygen and lactic acid. Warmup: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1. Main set: repeat 5 times (5 min in Zone 4 at 95 rpm + 5 min in Zone 1 at 85 rpm recovery). Cooldown: 10 min in Zone 1 at 90 rpm.'
  where title = 'Bicicleta fuerte (intervalos)';
update templates set title_en = 'Bike-to-run brick', notes_en =
  'Goal: get your legs used to running right off the bike. Bike: 5 min Zone 1 at 85 rpm, 5 min Zone 2 at 90 rpm, 5 min Zone 3 at 95 rpm, 5 min Zone 1, 40 min in Zone 3 at 95 rpm, 10 min in Zone 1. Dismount and go straight into a run: 20 min in Zone 3 + 10 min in Zone 1.'
  where title = 'Brick bici-carrera';
