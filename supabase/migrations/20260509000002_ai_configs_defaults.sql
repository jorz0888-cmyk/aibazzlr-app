-- ============================================================================
-- 20260509000002_ai_configs_defaults.sql
-- Add DB-side defaults for ai_configs columns that are NOT NULL but had no
-- default in production. Application code (applyAiConfigDefaults) already
-- supplies these values, but DB-side defaults are insurance for any future
-- INSERT path that forgets to.
-- ============================================================================

alter table public.ai_configs
  alter column posting_frequency  set default 'daily',
  alter column posting_times      set default '{"morning":"07:00","evening":"19:00"}'::jsonb,
  alter column social_account_ids set default '{}'::uuid[],
  alter column requires_approval  set default true,
  alter column status             set default 'active',
  alter column is_default         set default false,
  alter column hashtags_per_post  set default 3;

-- Backfill any existing NULL rows so subsequent NOT NULL toggles don't fail.
update public.ai_configs
   set posting_frequency = coalesce(posting_frequency, 'daily'),
       posting_times     = coalesce(posting_times, '{"morning":"07:00","evening":"19:00"}'::jsonb),
       social_account_ids = coalesce(social_account_ids, '{}'::uuid[]),
       requires_approval = coalesce(requires_approval, true),
       status            = coalesce(status, 'active'),
       is_default        = coalesce(is_default, false),
       hashtags_per_post = coalesce(hashtags_per_post, 3);
