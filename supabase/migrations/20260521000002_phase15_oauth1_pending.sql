-- Phase 15 (3-legged): in-flight OAuth 1.0a request_token storage.

create table if not exists public.oauth1_pending (
  oauth_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  oauth_token_secret_ciphertext text not null,
  oauth_token_secret_iv text not null,
  oauth_token_secret_tag text not null,
  redirect_after text,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth1_pending_user on public.oauth1_pending(user_id);
create index if not exists idx_oauth1_pending_expires on public.oauth1_pending(expires_at);

alter table public.oauth1_pending enable row level security;
drop policy if exists "Users can manage own pending" on public.oauth1_pending;
create policy "Users can manage own pending" on public.oauth1_pending
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
