-- Phase 8 hotfix: add the external_post_id column referenced by the
-- publish/retry routes. Production was throwing
--   "Could not find the 'external_post_id' column of 'posts' in the schema cache"
-- and leaving rows stuck in 'publishing' status after a successful X post.
--
-- The publish/retry code writes platform_post_id (new) + external_post_id
-- (legacy) in the same UPDATE; if either column is missing, the whole
-- UPDATE fails atomically, so platform_post_id never lands either.
--
-- This is purely additive: column is nullable, no defaults, no backfill.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS external_post_id TEXT;

-- Partial index for fast lookups by external id (typical query: "did we
-- already publish this row?" / "find by tweet id")
CREATE INDEX IF NOT EXISTS idx_posts_external_post_id
  ON public.posts (external_post_id)
  WHERE external_post_id IS NOT NULL;

COMMENT ON COLUMN public.posts.external_post_id IS
  'External platform post ID (e.g., X tweet_id) returned after successful posting. Mirror of platform_post_id kept for back-compat with older code paths.';
