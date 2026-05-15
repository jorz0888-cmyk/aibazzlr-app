-- Phase 9: add Stripe billing columns to profiles and migrate plan enum.

-- 1. Drop old CHECK constraint so we can rename values + add new options.
alter table public.profiles drop constraint if exists profiles_plan_check;

-- 2. Rename legacy plan values to the new naming scheme.
update public.profiles set plan = 'standard' where plan = 'starter';
update public.profiles set plan = 'premium' where plan = 'pro';

-- 3. Re-apply CHECK with the new vocabulary.
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'standard', 'premium'));

-- 4. Add Stripe billing columns.
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_id text,
  add column if not exists subscription_status text
    check (subscription_status is null or subscription_status in (
      'active', 'canceled', 'past_due', 'unpaid',
      'incomplete', 'incomplete_expired', 'trialing'
    )),
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz;

-- 5. Backfill plan='free' for any nulls (existing default).
update public.profiles set plan = 'free' where plan is null;

-- 6. Indexes used by webhook lookups and quota checks.
create index if not exists idx_profiles_stripe_customer_id on public.profiles(stripe_customer_id);
create index if not exists idx_profiles_subscription_id on public.profiles(subscription_id);
create index if not exists idx_profiles_plan on public.profiles(plan);
