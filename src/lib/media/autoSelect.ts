import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MediaLibraryRow } from "@/lib/supabase/types";
import { selectFromLibrary } from "./selector";

type Client = SupabaseClient<Database>;

export type AutoAttachResult = {
  media_id: string | null;
  image_url: string | null;
  source: "library" | "none";
};

/**
 * Look up the user's media library for the given AI config (or any user
 * library when none is provided), ask Claude to pick the best fit for the
 * post content, and return the chosen public URL + media id. Returns
 * `{ null, null, "none" }` if the library is empty or no match was found —
 * the post is then created without an image, which is a valid state.
 *
 * Free-tier users still benefit: this only looks at uploaded photos; the
 * AI-generation fallback is the separate /api/media/generate endpoint and
 * is intentionally not invoked here (cost + plan gating).
 */
export async function autoAttachLibraryImage(
  client: Client,
  userId: string,
  aiConfigId: string | null,
  postContent: string,
  hashtags: string[],
): Promise<AutoAttachResult> {
  let query = client
    .from("media_library")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (aiConfigId) query = query.eq("ai_config_id", aiConfigId);

  const { data, error } = await query;
  if (error) {
    console.error("[media/autoSelect] library lookup failed", error);
    return { media_id: null, image_url: null, source: "none" };
  }
  const candidates = (data ?? []) as MediaLibraryRow[];
  if (candidates.length === 0) {
    return { media_id: null, image_url: null, source: "none" };
  }

  const picked = await selectFromLibrary(postContent, hashtags, candidates);
  if (!picked) {
    return { media_id: null, image_url: null, source: "none" };
  }
  return {
    media_id: picked.id,
    image_url: picked.public_url,
    source: "library",
  };
}
