import type {
  EngagementData,
  GenerationMetadata,
  PostInsert,
  PostStatus,
} from "@/lib/supabase/types";

/**
 * Default values for posts columns that are NOT NULL in production but have
 * no DB-side default. Mirrors the shape of `applyAiConfigDefaults` and is
 * used by every INSERT site (Phase 7-1 manual flow + Phase 7-2 cron).
 */
export const POST_DEFAULTS = {
  status: "draft" as PostStatus,
  hashtags: [] as string[],
  platform: "x" as const,
  engagement_data: {} as EngagementData,
  generation_metadata: {} as GenerationMetadata,
  retry_count: 0,
};

/**
 * Coerce a partial Insert payload into a complete one by filling in safe
 * defaults for any NOT-NULL-but-default-less column. `scheduled_at` is set
 * to "now" so the row passes the constraint even before the DB-side
 * `DEFAULT now()` migration is applied.
 *
 * Always pass through this helper from any code path that inserts into the
 * posts table. Callers stay free to pass explicit values — they win over
 * the defaults.
 */
export function applyPostDefaults(input: Partial<PostInsert>): PostInsert {
  const nowIso = new Date().toISOString();
  return {
    ...input,
    status: input.status ?? POST_DEFAULTS.status,
    scheduled_at: input.scheduled_at ?? nowIso,
    hashtags: input.hashtags ?? POST_DEFAULTS.hashtags,
    platform: input.platform ?? POST_DEFAULTS.platform,
    engagement_data: input.engagement_data ?? POST_DEFAULTS.engagement_data,
    generation_metadata:
      input.generation_metadata ?? POST_DEFAULTS.generation_metadata,
    retry_count: input.retry_count ?? POST_DEFAULTS.retry_count,
  } as PostInsert;
}
