/**
 * Centralized fallback defaults for ai_configs columns that are NOT NULL in
 * production but have no DB-side default. Apply these via `applyAiConfigDefaults`
 * at every INSERT/UPDATE site so we never trip a 23502 again.
 *
 * Using `??` so explicit values from the caller (including from hearing
 * extraction) always win.
 */
export const AI_CONFIG_DEFAULTS = {
  posting_frequency: "daily" as const,
  posting_times: { morning: "07:00", evening: "19:00" } as const,
  social_account_ids: [] as string[],
  requires_approval: true,
  status: "active" as const,
  is_default: false,
  hashtags_per_post: 3,
  account_mode: "real" as const,
  ng_words: [] as string[],
  must_include_elements: [] as string[],
  good_examples: [] as string[],
  bad_examples: [] as string[],
  hashtag_pool: [] as string[],
  menu_items: [] as string[],
  seasonal_items: [] as string[],
  real_episodes: [] as string[],
  announcement_topics: [] as string[],
};

/**
 * Coerce nulls/undefineds in NOT-NULL columns to safe defaults. Keeps any
 * non-nullish value the caller passed.
 */
export function applyAiConfigDefaults<
  T extends Partial<Record<keyof typeof AI_CONFIG_DEFAULTS, unknown>>,
>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const key of Object.keys(AI_CONFIG_DEFAULTS) as (keyof typeof AI_CONFIG_DEFAULTS)[]) {
    if (out[key] === null || out[key] === undefined) {
      out[key] = AI_CONFIG_DEFAULTS[key];
    }
  }
  return out as T;
}
