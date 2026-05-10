-- ============================================================================
-- 20260510000002_posts_cleanup.sql
-- 既に X 側に投稿されているのに status が draft / failed のままになって
-- いる「孤児」レコードを posted に修復し、二重投稿のリスクをゼロにする。
--
-- これは1回限りの修復用 SQL。安全のため SELECT で件数を確認してから
-- UPDATE を流すこと:
--
--   SELECT id, status, platform_post_id, retry_count, error_message,
--          created_at, posted_at
--     FROM posts
--    WHERE platform_post_id IS NOT NULL
--      AND status NOT IN ('posted', 'published');
-- ============================================================================

update public.posts
   set status     = 'posted',
       posted_at  = coalesce(posted_at, updated_at, created_at),
       error_message = null
 where platform_post_id is not null
   and status not in ('posted', 'published');

-- 失敗ゴミデータ (retry_count >= 3) は手動で確認してから削除推奨。
-- 自動削除はしない (運用判断のため):
--
--   SELECT id, content, retry_count, error_message, created_at
--     FROM posts
--    WHERE status = 'failed' AND retry_count >= 3;
