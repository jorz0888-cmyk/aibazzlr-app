-- ============================================================================
-- 20260506000001_create_profiles.sql
-- Create public.profiles, RLS, and trigger that auto-creates a profile
-- whenever a new auth.users row is inserted.
-- ============================================================================

-- 1. Table -------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text,
  plan        text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- 2. Row Level Security ------------------------------------------------------
alter table public.profiles enable row level security;

-- A user can read their own profile
drop policy if exists "Profiles: own row read" on public.profiles;
create policy "Profiles: own row read"
  on public.profiles for select
  using (auth.uid() = id);

-- A user can update their own profile
drop policy if exists "Profiles: own row update" on public.profiles;
create policy "Profiles: own row update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3. updated_at trigger -------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- 4. Auto-create profile on signup -------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
