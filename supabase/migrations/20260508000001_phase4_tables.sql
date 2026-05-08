-- ============================================================================
-- 20260508000001_phase4_tables.sql
-- Phase 4: SNS連携 / AI設定 / 投稿 / 業種別プリセット
--
-- Reflects the actual production schema as of 2026-05-08.
-- If you change a column, also update src/lib/supabase/types.ts to match.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. social_accounts -- SNS連携
-- ---------------------------------------------------------------------------
create table if not exists public.social_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  platform          text not null check (platform in ('x', 'threads', 'instagram')),
  username          text not null,
  display_name      text,
  avatar_url        text,
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  status            text not null default 'active'
                      check (status in ('active', 'expired', 'disconnected', 'error')),
  is_primary        boolean not null default false,
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id, platform, username)
);

create index if not exists social_accounts_user_idx
  on public.social_accounts (user_id);
create index if not exists social_accounts_status_idx
  on public.social_accounts (status);

create unique index if not exists social_accounts_one_primary_per_platform
  on public.social_accounts (user_id, platform)
  where is_primary;

-- ---------------------------------------------------------------------------
-- 2. ai_configs -- AI設定
-- ---------------------------------------------------------------------------
create table if not exists public.ai_configs (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  name                        text not null,
  is_default                  boolean not null default false,
  status                      text,
  industry                    text,
  business_name               text,
  business_description        text,
  persona_role                text,
  world_view                  text,
  voice_tone                  text,
  target_audience             text,
  ng_words                    text[] not null default '{}',
  must_include_elements       text[] not null default '{}',
  good_examples               text[] not null default '{}',
  bad_examples                text[] not null default '{}',
  hashtag_pool                text[] not null default '{}',
  hashtags_per_post           integer not null default 0,
  posting_frequency           text,
  posting_times               jsonb,
  social_account_ids          uuid[] not null default '{}',
  generated_system_prompt     text,
  requires_approval           boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists ai_configs_user_idx on public.ai_configs (user_id);

create unique index if not exists ai_configs_one_default_per_user
  on public.ai_configs (user_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- 3. posts -- 投稿履歴
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  ai_config_id        uuid references public.ai_configs(id) on delete set null,
  social_account_id   uuid references public.social_accounts(id) on delete set null,
  status              text not null default 'draft'
                        check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at        timestamptz,
  published_at        timestamptz,
  content             text not null,
  image_url           text,
  external_post_id    text,
  engagement_count    integer not null default 0,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists posts_user_status_idx
  on public.posts (user_id, status);
create index if not exists posts_user_created_at_idx
  on public.posts (user_id, created_at desc);
create index if not exists posts_scheduled_idx
  on public.posts (scheduled_at)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- 4. prompt_templates -- 業種別プリセット (global, no user_id)
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_templates (
  id                              uuid primary key default gen_random_uuid(),
  industry                        text not null,
  name                            text not null,
  description                     text,
  default_world_view              text,
  default_voice_tone              text,
  default_persona_role            text,
  default_must_include_elements   text[] not null default '{}',
  default_good_examples           text[] not null default '{}',
  default_hashtag_pool            text[] not null default '{}',
  default_ng_words                text[] not null default '{}',
  is_published                    boolean not null default false,
  display_order                   integer not null default 0,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  unique (industry, name)
);

create index if not exists prompt_templates_industry_idx
  on public.prompt_templates (industry)
  where is_published;

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers (re-uses public.set_updated_at from initial migration)
-- ---------------------------------------------------------------------------
drop trigger if exists social_accounts_set_updated_at on public.social_accounts;
create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute procedure public.set_updated_at();

drop trigger if exists ai_configs_set_updated_at on public.ai_configs;
create trigger ai_configs_set_updated_at
  before update on public.ai_configs
  for each row execute procedure public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute procedure public.set_updated_at();

drop trigger if exists prompt_templates_set_updated_at on public.prompt_templates;
create trigger prompt_templates_set_updated_at
  before update on public.prompt_templates
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------

-- social_accounts ----------------------------------------------------------
alter table public.social_accounts enable row level security;

drop policy if exists "social_accounts: own row select" on public.social_accounts;
create policy "social_accounts: own row select"
  on public.social_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "social_accounts: own row insert" on public.social_accounts;
create policy "social_accounts: own row insert"
  on public.social_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "social_accounts: own row update" on public.social_accounts;
create policy "social_accounts: own row update"
  on public.social_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "social_accounts: own row delete" on public.social_accounts;
create policy "social_accounts: own row delete"
  on public.social_accounts for delete
  using (auth.uid() = user_id);

-- ai_configs ---------------------------------------------------------------
alter table public.ai_configs enable row level security;

drop policy if exists "ai_configs: own row select" on public.ai_configs;
create policy "ai_configs: own row select"
  on public.ai_configs for select
  using (auth.uid() = user_id);

drop policy if exists "ai_configs: own row insert" on public.ai_configs;
create policy "ai_configs: own row insert"
  on public.ai_configs for insert
  with check (auth.uid() = user_id);

drop policy if exists "ai_configs: own row update" on public.ai_configs;
create policy "ai_configs: own row update"
  on public.ai_configs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_configs: own row delete" on public.ai_configs;
create policy "ai_configs: own row delete"
  on public.ai_configs for delete
  using (auth.uid() = user_id);

-- posts --------------------------------------------------------------------
alter table public.posts enable row level security;

drop policy if exists "posts: own row select" on public.posts;
create policy "posts: own row select"
  on public.posts for select
  using (auth.uid() = user_id);

drop policy if exists "posts: own row insert" on public.posts;
create policy "posts: own row insert"
  on public.posts for insert
  with check (auth.uid() = user_id);

drop policy if exists "posts: own row update" on public.posts;
create policy "posts: own row update"
  on public.posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "posts: own row delete" on public.posts;
create policy "posts: own row delete"
  on public.posts for delete
  using (auth.uid() = user_id);

-- prompt_templates: read-only (only published) for any signed-in user ------
alter table public.prompt_templates enable row level security;

drop policy if exists "prompt_templates: read for authenticated" on public.prompt_templates;
create policy "prompt_templates: read for authenticated"
  on public.prompt_templates for select
  to authenticated
  using (is_published);
