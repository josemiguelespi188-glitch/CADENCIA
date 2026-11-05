-- Community event/training-start dates (Nov 2026) — see CLAUDE.md's
-- "Community event countdown + extended stats window + CTL progress
-- chart" section. Direct request: "Débería haber una barra the timing
-- para calcular cuando es el evento de la comunidad por el cual se
-- esta entrenando." Confirmed via AskUserQuestion: the coach sets both
-- dates manually (not auto-derived from anything).

alter table communities add column if not exists event_date date;
alter table communities add column if not exists training_start_date date;

comment on column communities.event_date is
  'The date of the race/event this community is training toward — set manually by the coach/admin, never auto-derived.';
comment on column communities.training_start_date is
  'When this community''s training block started — set manually by the coach/admin. Used to widen the community stats window beyond a fixed last-30-days range.';

-- communities had no update policy at all before this (only select +
-- insert) — needed so a coach/admin can actually set these two dates
-- from the UI. Mirrors the same created_by/is_admin check
-- communities_insert_coach already uses.
drop policy if exists communities_update_coach on communities;
create policy communities_update_coach on communities
  for update to authenticated
  using (
    created_by = (select id from athletes where auth_user_id = auth.uid())
    or exists (select 1 from athletes where auth_user_id = auth.uid() and is_admin)
  )
  with check (
    created_by = (select id from athletes where auth_user_id = auth.uid())
    or exists (select 1 from athletes where auth_user_id = auth.uid() and is_admin)
  );
