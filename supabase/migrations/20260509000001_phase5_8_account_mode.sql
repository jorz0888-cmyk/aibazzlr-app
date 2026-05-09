-- ============================================================================
-- 20260509000001_phase5_8_account_mode.sql
-- Phase 5.8: アカウントモード分離 (real / fictional)
--
-- This is a record of the production schema change already applied to prod.
-- Existing rows default to 'real'. Existing sessions with NULL account_mode
-- are treated as 'real' at the application layer.
-- ============================================================================

-- 1. ai_configs --------------------------------------------------------------
alter table public.ai_configs
  add column if not exists account_mode text not null default 'real'
    check (account_mode in ('real', 'fictional'));

alter table public.ai_configs
  add column if not exists business_hours        text,
  add column if not exists closed_days           text,
  add column if not exists address               text,
  add column if not exists price_range           text,
  add column if not exists menu_items            text[] not null default '{}',
  add column if not exists seasonal_items        text[] not null default '{}',
  add column if not exists real_episodes         text[] not null default '{}',
  add column if not exists announcement_topics   text[] not null default '{}';

create index if not exists ai_configs_user_mode_idx
  on public.ai_configs (user_id, account_mode);

-- 2. ai_hearing_sessions ----------------------------------------------------
alter table public.ai_hearing_sessions
  add column if not exists account_mode text not null default 'real'
    check (account_mode in ('real', 'fictional'));
