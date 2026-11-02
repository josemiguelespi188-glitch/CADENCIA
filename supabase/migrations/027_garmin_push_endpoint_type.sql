-- Garmin's real "API Tools -> Endpoint Configuration" page (confirmed
-- live, Nov 2026) registers a SEPARATE URL per data type (ACTIVITY -
-- Activities, ACTIVITY - Activity Details, COMMON - Deregistrations,
-- etc.), not one single generic webhook as first assumed — see
-- CLAUDE.md's "Garmin Connect Developer Program" section and the new
-- app/api/webhooks/garmin/[type]/route.ts. This column records which
-- registered endpoint a given push arrived on, so a payload's type is
-- known from the URL it hit, never guessed from its body shape.
alter table garmin_push_events add column if not exists endpoint_type text;
