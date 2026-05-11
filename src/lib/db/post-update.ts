import type { DBClient } from "./_client-type";

const DB_UPDATE_DEFAULT_RETRIES = 3;

/**
 * Update a row in `posts` with exponential-backoff retry (200/400/800ms).
 * Used by publish/retry routes after a successful X API call: we MUST get
 * platform_post_id and status=posted into the database to prevent zombie
 * "publishing" rows. A brief Supabase blip used to leave the row stuck;
 * 3 retries cover the common transient cases.
 */
export async function updatePostWithRetry(
  supabase: DBClient,
  postId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updates: Record<string, any>,
  maxRetries = DB_UPDATE_DEFAULT_RETRIES,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let lastError = "Unknown DB error";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { error } = await supabase
      .from("posts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq("id", postId);
    if (!error) return { ok: true };
    lastError = error.message;
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, error: lastError };
}
