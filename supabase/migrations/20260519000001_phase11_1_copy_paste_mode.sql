-- Phase 11.1: copy-paste posting mode.
-- X imposes API-post restrictions on brand-new accounts, so we add a third
-- mode that never touches the X API: AI generates, the user copies the text
-- and posts it themselves in the X app or web.

alter table public.ai_configs drop constraint if exists ai_configs_posting_mode_check;
alter table public.ai_configs
  add constraint ai_configs_posting_mode_check
  check (posting_mode in ('auto', 'approval', 'manual'));

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts
  add constraint posts_status_check check (status in (
    'pending', 'draft', 'pending_approval', 'approved', 'rejected',
    'awaiting_manual_post', 'posted_manually',
    'publishing', 'queued', 'posted', 'published', 'failed'
  ));
