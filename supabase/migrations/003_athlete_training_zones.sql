-- Cadencia — 003: editable training-zone thresholds per athlete.
-- Explicit product decision (Oct 2026): LTHR, running threshold pace, bike
-- FTP, and VO2max are the numbers that will later drive AI-generated
-- training plans and a virtual coach agent (see CLAUDE.md's roadmap) —
-- neither of those is built yet, this migration only adds the editable
-- fields themselves. Run once in the SQL editor. Idempotent (safe to re-run).

alter table athletes
  add column if not exists threshold_hr integer,
  add column if not exists threshold_pace_sec_per_km integer,
  add column if not exists ftp_watts integer,
  add column if not exists vo2max numeric(4,1);

comment on column athletes.threshold_hr is 'Lactate threshold heart rate (LTHR), in bpm.';
comment on column athletes.threshold_pace_sec_per_km is 'Running threshold pace ("race predictor"), in seconds per km.';
comment on column athletes.ftp_watts is 'Cycling functional threshold power (FTP), in watts.';
comment on column athletes.vo2max is 'VO2max, in ml/kg/min.';
