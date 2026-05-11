-- ============================================================================
-- 20260511000001_phase7_3_stuck_cleanup.sql
-- Phase 7.3: stuck "publishing" posts auto-recovery.
--
-- 背景: publish/retry route が X API 呼び出し中に Vercel の maxDuration=60s
-- でタイムアウトすると、catch 節に到達できないまま関数が強制終了する。
-- 結果: posts.status='publishing' / platform_post_id=NULL / error_message=NULL
-- のゾンビレコードが残り、UI からは「処理中」のまま消えない。
--
-- 対策: pg_cron で 5 分おきに cleanup_stuck_publishing_posts() を実行し、
-- updated_at > 5分前のレコードを以下に倒す:
--   - platform_post_id あり → 'posted' (X 側は成功している)
--   - platform_post_id なし → 'failed' (関数死亡 / X API 失敗)
--
-- 関数は手動でも呼べる: SELECT public.cleanup_stuck_publishing_posts();
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_stuck_publishing_posts()
RETURNS TABLE (auto_posted INTEGER, auto_failed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted INTEGER;
  v_failed INTEGER;
BEGIN
  WITH updated AS (
    UPDATE posts
       SET status = 'posted',
           posted_at = COALESCE(posted_at, NOW()),
           updated_at = NOW()
     WHERE status = 'publishing'
       AND updated_at < NOW() - INTERVAL '5 minutes'
       AND platform_post_id IS NOT NULL
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_posted FROM updated;

  WITH updated AS (
    UPDATE posts
       SET status = 'failed',
           error_message = COALESCE(
             error_message,
             'Auto-recovery: stuck in publishing for >5 minutes (no platform_post_id). '
             || 'Likely a serverless timeout during the X API call.'
           ),
           updated_at = NOW()
     WHERE status = 'publishing'
       AND updated_at < NOW() - INTERVAL '5 minutes'
       AND platform_post_id IS NULL
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_failed FROM updated;

  RETURN QUERY SELECT v_posted, v_failed;
END;
$$;

COMMENT ON FUNCTION public.cleanup_stuck_publishing_posts() IS
  'Phase 7.3: recovers posts stuck in status=''publishing''. Runs every 5 minutes via pg_cron.';

-- Schedule (idempotent): unschedule existing, then re-schedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stuck-publishing-posts') THEN
    PERFORM cron.unschedule('cleanup-stuck-publishing-posts');
  END IF;
END $$;

SELECT cron.schedule(
  'cleanup-stuck-publishing-posts',
  '*/5 * * * *',
  $cron$SELECT public.cleanup_stuck_publishing_posts();$cron$
);
