-- 2026-05-23: prevent the same X account being actively linked from
-- two AIBazzlr users at the same time.
--
-- Existing per-user constraints already stop a single AIBazzlr user
-- from connecting the same X account twice, but did NOT stop user B
-- from connecting an account that user A had already linked. That
-- would cause:
--   - duplicate auto-posts to the same X timeline (each user's cron
--     fires independently),
--   - silent failures when one user revoked OAuth (the other side
--     still thought it was healthy),
--   - a quiet account-takeover path for ex-staff who'd kept their
--     X credentials but lost AIBazzlr access.
--
-- Active-only so a previously-linked account can be re-claimed once
-- the prior connection is disconnected or errored out — without this
-- exclusion, a one-off bad disconnect would lock the X account out
-- of AIBazzlr forever.
--
-- Verified 0 existing duplicates at apply time.

create unique index if not exists social_accounts_active_platform_account_unique
  on public.social_accounts (platform, platform_account_id)
  where status = 'active';
