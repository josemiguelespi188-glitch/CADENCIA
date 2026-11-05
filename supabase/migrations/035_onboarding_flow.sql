-- Onboarding flow (Nov 2026, direct request: "cuando entro debería hacerme
-- llenar todo el perfil... y pedirme que me conecte con los diferentes
-- apis"). A brand-new account (self-registered via / or admin-invited
-- via /accept-invite) now gets routed to /onboarding on its first sign-in
-- until it marks itself done — see lib/auth-context.tsx and
-- app/onboarding/page.tsx.
--
-- Default FALSE so every future insert (self-registration, admin invite,
-- Google sign-up) starts needing onboarding; existing rows are backfilled
-- to TRUE right after, since Juan/José are already using the app and
-- shouldn't suddenly be forced through a first-run wizard.
alter table athletes add column if not exists onboarding_completed boolean not null default false;
update athletes set onboarding_completed = true where onboarding_completed = false;
comment on column athletes.onboarding_completed is 'Has this athlete finished the /onboarding wizard (profile + connections)? Existing rows were backfilled to true when this column was added.';
