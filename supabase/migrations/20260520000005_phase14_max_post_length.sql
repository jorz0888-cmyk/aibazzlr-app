-- Phase 14: per-AI-config post length cap. Defaults to 280 (X standard).
-- Existing rows pick up the default through ALTER ADD COLUMN ... DEFAULT.

alter table public.ai_configs
  add column if not exists max_post_length integer not null default 280
    check (max_post_length between 50 and 25000);
