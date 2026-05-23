-- 2026-05-23: allow status='draft' on ai_configs.
--
-- The T1 auto-save logic (c29b237 / cabf831) attempted to insert
-- rows with status='draft' to represent a hearing that finished but
-- whose AI config hasn't been activated yet by the user. The DB
-- CHECK constraint ai_configs_status_check was set to allow only
-- {active, paused, archived}, so every auto-save INSERT silently
-- failed with 23514. The helper caught the error and returned null;
-- the preview page UI kept rendering its static "下書き保存済み"
-- copy regardless — green-light text while the DB had nothing.
--
-- This migration drops and re-adds the constraint with 'draft'
-- included. No data backfill needed by the DDL itself (no existing
-- row used the missing value); a separate one-shot backfill of
-- orphan sessions runs in the same deployment.

alter table public.ai_configs
  drop constraint ai_configs_status_check;

alter table public.ai_configs
  add constraint ai_configs_status_check
    check (status = any (array['draft', 'active', 'paused', 'archived']));
