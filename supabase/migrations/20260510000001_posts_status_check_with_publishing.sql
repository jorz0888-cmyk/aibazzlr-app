-- ============================================================================
-- 20260510000001_posts_status_check_with_publishing.sql
-- Phase 7-1 緊急修正: status CHECK 制約に 'publishing' を含めて
-- 二重投稿防止用の楽観的ロック (status: draft/failed → publishing) が
-- DB 側で受理されるようにする。
--
-- 既存の制約名はDBによって異なる可能性があるので、まず DROP IF EXISTS
-- で安全に剥がしてから ADD する。
--
-- 既存データ修復は別 migration / 別実行で行う:
--   UPDATE posts SET status='posted', posted_at = COALESCE(posted_at, updated_at, created_at)
--    WHERE platform_post_id IS NOT NULL AND status NOT IN ('posted','published');
-- ============================================================================

alter table public.posts
  drop constraint if exists posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status = any (array[
    'pending'::text,
    'draft'::text,
    'publishing'::text,  -- ★ 追加: 投稿中ロック用
    'queued'::text,
    'scheduled'::text,
    'approved'::text,
    'rejected'::text,
    'posted'::text,
    'published'::text,
    'failed'::text,
    'cancelled'::text
  ]));
