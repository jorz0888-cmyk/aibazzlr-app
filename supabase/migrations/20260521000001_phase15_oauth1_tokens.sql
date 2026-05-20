-- Phase 15: store per-account OAuth 1.0a User Context tokens so X media
-- + tweet publishing can use the auth method n8n proved out.

alter table public.social_accounts
  add column if not exists oauth1_access_token text,
  add column if not exists oauth1_access_token_iv text,
  add column if not exists oauth1_access_token_tag text,
  add column if not exists oauth1_access_token_secret text,
  add column if not exists oauth1_access_token_secret_iv text,
  add column if not exists oauth1_access_token_secret_tag text;
