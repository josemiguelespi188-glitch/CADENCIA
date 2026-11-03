-- Seed starting "Base workouts" presets (Nov 2026), per direct request:
-- load the Ironman 70.3 run-session examples and the Garmin 12-week
-- Olympic-distance plan's distinct swim/bike session types the user
-- shared, as reusable templates on the /templates page's preset grid
-- -- not a full dated plan import (that's what the Excel importer on
-- the same page is for), just the recurring session *types* an
-- athlete can drop onto any day.
--
-- `templates` has no unique constraint on title (two presets with the
-- same name is a legitimate thing an admin could create by hand), so
-- each row below is inserted only if a row with that exact title
-- doesn't already exist -- idempotent on a re-run without adding a DB
-- constraint that would reject an athlete's own duplicate title later.
--
-- Run sessions (10) adapted from fljuga.co.uk's "Entrenamientos de
-- carrera Ironman 70.3: 10 ejemplos de sesiones de entrenamiento".
-- Swim/bike sessions (10) adapted from Garmin's "Plan de entrenamiento
-- triatlón programa 12 semanas - nivel medio olímpico" (distinct
-- session *types* pulled from across its 12 weeks, not every week's
-- numeric variant -- minutes/km are approximate midpoints of what the
-- source gives, since these are reusable starting points an athlete
-- edits per use, not a fixed prescription).

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Carrera larga', 115, 0,
  'Objetivo: desarrollar la resistencia y la base aeróbica. Calentamiento: 15 min trote. Serie principal: 80-100 min en Zona 2. Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Carrera larga');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Carrera de ritmo', 60, 0,
  'Objetivo: mejorar la fuerza aeróbica y el control del ritmo. Calentamiento: 15 min trote. Serie principal: 35 min en Zona 3. Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Carrera de ritmo');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Intervalos de umbral', 63, 0,
  'Objetivo: aumentar tu velocidad sostenible. Calentamiento: 15 min trote. Serie principal: 4 x 8 min en Zona 4 (2 min trote de recuperación entre series). Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Intervalos de umbral');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Carrera fácil', 50, 0,
  'Objetivo: promover la recuperación aeróbica y mantener el volumen estable. Calentamiento: 5 min trote. Serie principal: 40 min en Zona 1-2. Enfriamiento: 5 min trote.'
where not exists (select 1 from templates where title = 'Carrera fácil');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Carrera de progresión', 60, 0,
  'Objetivo: enseñar control y terminar fuerte. Calentamiento: 15 min trote. Serie principal: 15 min en Zona 2, 15 min en Zona 3, 5 min en Zona 4. Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Carrera de progresión');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Esfuerzos de ritmo de carrera', 70, 8,
  'Objetivo: practicar el ritmo de carrera y el control del ritmo. Calentamiento: 15 min trote. Serie principal: 2 x 4 km al ritmo de carrera objetivo de Ironman 70.3 (4 min trote de recuperación entre series). Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Esfuerzos de ritmo de carrera');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Repeticiones de VO2 Max', 55, 0,
  'Objetivo: aumentar el techo aeróbico y la velocidad. Calentamiento: 15 min trote + zancadas. Serie principal: 5 x 3 min en Zona 5 (3 min trote de recuperación entre series). Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Repeticiones de VO2 Max');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Conjunto de ritmo roto', 61, 0,
  'Objetivo: hacer que el trabajo de tempo sea más repetible y digerible. Calentamiento: 15 min trote. Serie principal: 3 x 10 min en Zona 3 (2 min trote de recuperación entre series). Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Conjunto de ritmo roto');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Final rápido, carrera larga', 75, 0,
  'Objetivo: practicar el ritmo y los finales fuertes. Calentamiento: 10 min trote. Serie principal: 50 min en Zona 2, 15 min en Zona 3. Enfriamiento: 10 min trote.'
where not exists (select 1 from templates where title = 'Final rápido, carrera larga');

insert into templates (sport, title, minutes, km, notes)
select 'run', 'Carrera de recuperación', 40, 0,
  'Objetivo: mantenerse relajado y apoyar la adaptación. Calentamiento: 5 min trote. Serie principal: 30 min en Zona 1. Enfriamiento: 5 min trote.'
where not exists (select 1 from templates where title = 'Carrera de recuperación');

insert into templates (sport, title, minutes, km, notes)
select 'swim', 'Natación técnica', 0, 1.2,
  'Sesión centrada en técnica, no en velocidad. Calentamiento: 300 m en Zona 1 (estilo libre y espalda). Serie principal: 5 x (25 m piernas, 50 m técnica, 75 m natación) en Zona 1 + 20 s de descanso. Enfriamiento: 150 m tirón o natación en Zona 1. Trabaja el agarre y la recuperación del brazo.'
where not exists (select 1 from templates where title = 'Natación técnica');

insert into templates (sport, title, minutes, km, notes)
select 'swim', 'Natación continua', 0, 1.8,
  'Objetivo: resistencia aeróbica en el agua. Calentamiento: 300 m en Zona 1 (con algo de espalda). Bloque: 2 x 50 m piernas en Zona 1 + 10 s. Serie principal: 6 x 200 m natación o tirón en Zona 2 + 20 s. Enfriamiento: 200 m en Zona 1. Cuenta las brazadas cada tercer largo de 50 m para controlar tu técnica.'
where not exists (select 1 from templates where title = 'Natación continua');

insert into templates (sport, title, minutes, km, notes)
select 'swim', 'Natación a ritmo de carrera', 0, 2.2,
  'Objetivo: practicar el ritmo de carrera objetivo. Calentamiento: 200 m en Zona 1 (estilo libre y espalda). Bloque: 2 x 50 m técnica en Zona 1 + 10 s. Bloque: 4 x 50 m incrementando Zona 1-Zona 4 + 15 s. Serie principal: 5 x 300 m en Zona 3 + 30 s, buscando tu velocidad de carrera objetivo. Enfriamiento: 200 m en Zona 1.'
where not exists (select 1 from templates where title = 'Natación a ritmo de carrera');

insert into templates (sport, title, minutes, km, notes)
select 'swim', 'Natación en aguas abiertas', 40, 0,
  'Objetivo: adaptarse al entorno de aguas abiertas antes de la carrera. Calentamiento: 5 min en Zona 1. Serie principal: 3 x 8 min en Zona 2 respirando bilateralmente, con 2 min de recuperación entre series. Enfriamiento: 5 min en Zona 1 con patada y natación suave.'
where not exists (select 1 from templates where title = 'Natación en aguas abiertas');

insert into templates (sport, title, minutes, km, notes)
select 'swim', 'Natación progresiva', 0, 2.4,
  'Objetivo: aumentar la velocidad manteniendo la técnica a medida que sube la intensidad. Calentamiento: 3 x 100 m en Zona 1 + 10 s (combinación de piernas, tirón y natación). Serie principal: 800 m en Zona 2 + 60 s, 600 m en Zona 3 + 40 s, 400 m en Zona 4. Enfriamiento: 300 m en Zona 1 (estilo libre y espalda).'
where not exists (select 1 from templates where title = 'Natación progresiva');

insert into templates (sport, title, minutes, km, notes)
select 'bike', 'Bicicleta suave', 70, 0,
  'Objetivo: rodaje aeróbico suave, sin acumular fatiga. Bloque: 5 min en Zona 1 a 90 rpm. Bloque: 5 min en Zona 1 a 80 rpm. Serie principal: 55 min en Zona 1 a 90-95 rpm. Enfriamiento: 5 min muy suave. Puedes hacerlo en carretera o en rodillo/turbo.'
where not exists (select 1 from templates where title = 'Bicicleta suave');

insert into templates (sport, title, minutes, km, notes)
select 'bike', 'Bicicleta con cuestas', 150, 0,
  'Objetivo: fuerza y resistencia en subida. Repite 3 veces: 30 min en Zona 1 a 90 rpm + 20 min en Zona 2 a 75 rpm. Monta sobre terreno con cuestas, sin levantarte del sillín, pedaleando uniformemente para minimizar los puntos muertos.'
where not exists (select 1 from templates where title = 'Bicicleta con cuestas');

insert into templates (sport, title, minutes, km, notes)
select 'bike', 'Bicicleta de prueba (TT)', 60, 16,
  'Objetivo: medir tu progreso a contrarreloj. Calentamiento: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1. Serie principal: 16 km contrarreloj a la mejor marca posible, anotando tiempo y frecuencia cardíaca. Enfriamiento: 10 min en Zona 1. Usa siempre el mismo recorrido para poder comparar.'
where not exists (select 1 from templates where title = 'Bicicleta de prueba (TT)');

insert into templates (sport, title, minutes, km, notes)
select 'bike', 'Bicicleta fuerte (intervalos)', 80, 0,
  'Objetivo: aumentar la capacidad de procesar oxígeno y ácido láctico. Calentamiento: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1. Serie principal: repite 5 veces (5 min en Zona 4 a 95 rpm + 5 min en Zona 1 a 85 rpm de recuperación). Enfriamiento: 10 min en Zona 1 a 90 rpm.'
where not exists (select 1 from templates where title = 'Bicicleta fuerte (intervalos)');

insert into templates (sport, title, minutes, km, notes)
select 'bike', 'Brick bici-carrera', 85, 0,
  'Objetivo: acostumbrar las piernas a correr justo después de pedalear. Bicicleta: 5 min Zona 1 a 85 rpm, 5 min Zona 2 a 90 rpm, 5 min Zona 3 a 95 rpm, 5 min Zona 1, 40 min en Zona 3 a 95 rpm, 10 min en Zona 1. Bájate de la bici y sal directo a correr: 20 min en Zona 3 + 10 min en Zona 1.'
where not exists (select 1 from templates where title = 'Brick bici-carrera');
