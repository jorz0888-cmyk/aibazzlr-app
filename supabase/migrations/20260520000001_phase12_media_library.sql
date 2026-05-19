-- Phase 12: media library + post image linkage + AI image quota counter.

create table if not exists public.media_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ai_config_id uuid references public.ai_configs(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  source text not null check (source in ('upload', 'ai_generated')),
  tags text[] not null default array[]::text[],
  ai_description text,
  width integer,
  height integer,
  file_size_bytes integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_media_library_user_config
  on public.media_library(user_id, ai_config_id);
create index if not exists idx_media_library_tags
  on public.media_library using gin(tags);

alter table public.media_library enable row level security;

drop policy if exists "Users can manage own media" on public.media_library;
create policy "Users can manage own media" on public.media_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.profiles
  add column if not exists ai_images_used_this_period integer not null default 0,
  add column if not exists ai_images_period_start timestamptz;

alter table public.posts
  add column if not exists media_id uuid references public.media_library(id) on delete set null,
  add column if not exists image_url text;
