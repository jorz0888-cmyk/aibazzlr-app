-- Phase 11: auto-post scheduler.

-- 1. schedules table
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  ai_config_id uuid not null references public.ai_configs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hour integer not null check (hour between 0 and 23),
  minute integer not null default 0 check (minute between 0 and 59),
  weekdays integer[] not null default array[0,1,2,3,4,5,6],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_unique_slot unique (ai_config_id, hour, minute)
);

create index if not exists idx_schedules_lookup
  on public.schedules(hour, minute, enabled) where enabled = true;
create index if not exists idx_schedules_user_id on public.schedules(user_id);
create index if not exists idx_schedules_ai_config_id on public.schedules(ai_config_id);

alter table public.schedules enable row level security;

drop policy if exists "Users can view their own schedules" on public.schedules;
create policy "Users can view their own schedules" on public.schedules
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own schedules" on public.schedules;
create policy "Users can insert their own schedules" on public.schedules
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own schedules" on public.schedules;
create policy "Users can update their own schedules" on public.schedules
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own schedules" on public.schedules;
create policy "Users can delete their own schedules" on public.schedules
  for delete using (auth.uid() = user_id);

-- 2. ai_configs columns
alter table public.ai_configs
  add column if not exists posting_mode text not null default 'approval'
    check (posting_mode in ('auto', 'approval')),
  add column if not exists auto_post_enabled boolean not null default false;

-- 3. posts columns + extended status enum
alter table public.posts
  add column if not exists triggered_by text not null default 'manual'
    check (triggered_by in ('manual', 'schedule')),
  add column if not exists schedule_id uuid references public.schedules(id) on delete set null,
  add column if not exists approval_token uuid default gen_random_uuid();

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts
  add constraint posts_status_check check (status in (
    'pending', 'draft', 'pending_approval', 'approved', 'rejected',
    'publishing', 'queued', 'posted', 'published', 'failed'
  ));

create index if not exists idx_posts_schedule_lookup
  on public.posts(user_id, status, created_at desc);

-- 4. updated_at trigger
create or replace function public.tg_schedules_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists schedules_set_updated_at on public.schedules;
create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function public.tg_schedules_updated_at();
