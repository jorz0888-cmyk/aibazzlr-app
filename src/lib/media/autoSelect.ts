import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentPillar,
  Database,
  ImageSource,
  MediaLibraryRow,
} from "@/lib/supabase/types";
import { selectFromLibrary } from "./selector";
import {
  buildImagePromptFromPost,
  generateAiImageForUser,
  GeminiGenerationError,
} from "./aiGenerate";
import { getPlanLimits, isPaidPlan, type Plan } from "@/lib/plans";

type Client = SupabaseClient<Database>;

/**
 * Phase 20 (2026-05-24): pool-building image selection.
 *
 * Design constraints (from product review):
 *   1. Anti-recency exclusion window W must be < target pool P, or
 *      steady state has zero candidates and we either bug-loop on
 *      fallthrough or drain quota every post. W=5, P=8 keeps a
 *      breathing room of 3.
 *   2. image_ref on posts is ALWAYS the real media_library UUID
 *      (never the literal "generated"). Without this the recency
 *      filter cannot identify AI-generated images and they recycle.
 *   3. Quota-exhausted fallback uses LRU repeat (oldest-last-used
 *      image) rather than text-only — picture > no picture.
 */

const RECENT_EXCLUSION_WINDOW = 5; // (1) ≤ TARGET_POOL_SIZE - 2
const TARGET_POOL_SIZE = 8;
const RECENT_DESCRIPTION_HINT_WINDOW = 5;

export type AutoAttachSource =
  | "library"
  | "ai_generated"
  | "library_lru_repeat"
  | "none";

export type AutoAttachResult = {
  media_id: string | null;
  image_url: string | null;
  source: AutoAttachSource;
};

export async function autoAttachLibraryImage(
  client: Client,
  userId: string,
  aiConfigId: string | null,
  postContent: string,
  hashtags: string[],
  topicTags: string[] = [],
  options: {
    /**
     * Legacy boolean kept for back-compat with callers that haven't
     * been updated to pass imageSource yet. When both are passed,
     * imageSource wins. false here is interpreted as 'library_only'
     * on the read path — never as "skip entirely" — because Phase 20
     * removed the text-only-only mode in favour of explicit enum
     * intent.
     */
    imageGenerationEnabled?: boolean;
    /** Phase 20: 'library_only' | 'ai_only' | 'both'. Defaults to 'both'. */
    imageSource?: ImageSource;
    pillar?: ContentPillar | null;
  } = {},
): Promise<AutoAttachResult> {
  // ----- 0. Resolve the per-config image-source policy --------------------
  const imageSource: ImageSource =
    options.imageSource ??
    (options.imageGenerationEnabled === false ? "library_only" : "both");

  // ----- 1. Recent image refs (exclusion + LRU + Gemini hint) -------------
  // ONE read, narrow window. We read more than RECENT_EXCLUSION_WINDOW so
  // the LRU fallback has something to sort over; the exclusion uses the
  // first W entries only.
  let recentRefs: string[] = [];
  let recentDescriptions: string[] = [];
  if (aiConfigId) {
    const { data: recentPosts } = await client
      .from("posts")
      .select("image_ref")
      .eq("ai_config_id", aiConfigId)
      .not("image_ref", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    recentRefs = (recentPosts ?? [])
      .map((p) => p.image_ref)
      .filter((x): x is string => typeof x === "string" && x.length > 0);

    // Anti-similarity hint to Gemini: descriptions of the most-recent
    // images. All image_refs are now actual media_ids (the "generated"
    // sentinel was removed Phase 20).
    const hintRefs = recentRefs.slice(0, RECENT_DESCRIPTION_HINT_WINDOW);
    if (hintRefs.length > 0) {
      const { data: descs } = await client
        .from("media_library")
        .select("id, ai_description, tags")
        .in("id", hintRefs);
      const descMap = new Map<string, string>();
      for (const d of descs ?? []) {
        const desc =
          (typeof d.ai_description === "string" && d.ai_description) ||
          (Array.isArray(d.tags) ? d.tags.join(", ") : "");
        if (desc) descMap.set(d.id, desc);
      }
      recentDescriptions = hintRefs
        .map((id) => descMap.get(id))
        .filter((s): s is string => Boolean(s));
    }
  }
  const excludedFromRecency = new Set(
    recentRefs.slice(0, RECENT_EXCLUSION_WINDOW),
  );

  // ----- 2. Library state -------------------------------------------------
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
  const rawCandidates = (data ?? []) as MediaLibraryRow[];
  const uploadedCandidates = rawCandidates.filter(
    (m) => m.source !== "ai_generated",
  );
  const aiCandidates = rawCandidates.filter(
    (m) => m.source === "ai_generated",
  );

  console.log("[media/autoSelect] enter", {
    user_id: userId,
    ai_config_id: aiConfigId,
    image_source: imageSource,
    library_total: rawCandidates.length,
    library_uploaded: uploadedCandidates.length,
    library_ai: aiCandidates.length,
    recent_refs: recentRefs.length,
    excluded_window: excludedFromRecency.size,
  });

  // ----- 3. Apply the per-config image-source policy ---------------------

  if (imageSource === "library_only") {
    // Only uploaded photos. AI generations in the library are
    // intentionally ignored — they were created under a prior policy
    // and the user has since said "uploads only".
    return pickFromCandidates(
      uploadedCandidates,
      excludedFromRecency,
      recentRefs,
      postContent,
      hashtags,
      "library",
    );
  }

  if (imageSource === "ai_only") {
    // Pool-build: maintain TARGET_POOL_SIZE AI images, then rotate.
    return aiOnlyPath({
      client,
      userId,
      aiConfigId,
      aiCandidates,
      excludedFromRecency,
      recentRefs,
      postContent,
      hashtags,
      topicTags,
      pillar: options.pillar ?? null,
      recentDescriptions,
    });
  }

  // imageSource === "both" — upload-preferred, Gemini-augmented
  return bothPath({
    client,
    userId,
    aiConfigId,
    rawCandidates,
    uploadedCandidates,
    aiCandidates,
    excludedFromRecency,
    recentRefs,
    postContent,
    hashtags,
    topicTags,
    pillar: options.pillar ?? null,
    recentDescriptions,
  });
}

// ---------------------------------------------------------------------------
// Per-policy paths
// ---------------------------------------------------------------------------

async function aiOnlyPath(opts: {
  client: Client;
  userId: string;
  aiConfigId: string | null;
  aiCandidates: MediaLibraryRow[];
  excludedFromRecency: Set<string>;
  recentRefs: string[];
  postContent: string;
  hashtags: string[];
  topicTags: string[];
  pillar: ContentPillar | null;
  recentDescriptions: string[];
}): Promise<AutoAttachResult> {
  const {
    client,
    userId,
    aiConfigId,
    aiCandidates,
    excludedFromRecency,
    recentRefs,
    postContent,
    hashtags,
    topicTags,
    pillar,
    recentDescriptions,
  } = opts;

  // Build the pool first if it's still small AND quota remains.
  if (aiCandidates.length < TARGET_POOL_SIZE) {
    const generated = await tryGeminiGenerate({
      client,
      userId,
      aiConfigId,
      postContent,
      hashtags,
      topicTags,
      pillar,
      recentDescriptions,
      reason: "pool_buildup",
      currentPoolSize: aiCandidates.length,
    });
    if (generated) return generated;
    // Generate failed (quota / API key / Gemini error) — fall through
    // to rotation/LRU on existing pool below.
  }

  // Rotate within the pool (excluding the last W). All AI rows are
  // still stored in media_library, so the source label is "library"
  // — the policy label lives on the config, not the post.
  return pickFromCandidates(
    aiCandidates,
    excludedFromRecency,
    recentRefs,
    postContent,
    hashtags,
    "library",
  );
}

async function bothPath(opts: {
  client: Client;
  userId: string;
  aiConfigId: string | null;
  rawCandidates: MediaLibraryRow[];
  uploadedCandidates: MediaLibraryRow[];
  aiCandidates: MediaLibraryRow[];
  excludedFromRecency: Set<string>;
  recentRefs: string[];
  postContent: string;
  hashtags: string[];
  topicTags: string[];
  pillar: ContentPillar | null;
  recentDescriptions: string[];
}): Promise<AutoAttachResult> {
  const {
    client,
    userId,
    aiConfigId,
    rawCandidates,
    uploadedCandidates,
    aiCandidates,
    excludedFromRecency,
    recentRefs,
    postContent,
    hashtags,
    topicTags,
    pillar,
    recentDescriptions,
  } = opts;

  // If uploads exist, prefer them — they're real photos of the user's
  // business, almost always a better fit than AI.
  if (uploadedCandidates.length > 0) {
    return pickFromCandidates(
      uploadedCandidates,
      excludedFromRecency,
      recentRefs,
      postContent,
      hashtags,
      "library",
    );
  }

  // No uploads. If AI pool is still small, build it.
  if (aiCandidates.length < TARGET_POOL_SIZE) {
    const generated = await tryGeminiGenerate({
      client,
      userId,
      aiConfigId,
      postContent,
      hashtags,
      topicTags,
      pillar,
      recentDescriptions,
      reason: "pool_buildup",
      currentPoolSize: aiCandidates.length,
    });
    if (generated) return generated;
  }

  // Pool full (or quota exhausted) — rotate within library (uploads ∅
  // here so this is AI candidates only).
  if (rawCandidates.length > 0) {
    return pickFromCandidates(
      rawCandidates,
      excludedFromRecency,
      recentRefs,
      postContent,
      hashtags,
      "library",
    );
  }

  // Truly nothing. Last try: a one-shot Gemini even after the pool
  // gate, in case earlier branches found neither uploads nor existing
  // AI rows (cold start with quota OK).
  const cold = await tryGeminiGenerate({
    client,
    userId,
    aiConfigId,
    postContent,
    hashtags,
    topicTags,
    pillar,
    recentDescriptions,
    reason: "cold_start",
    currentPoolSize: 0,
  });
  if (cold) return cold;

  console.log("[media/autoSelect] no image attached (fail-soft text-only)");
  return { media_id: null, image_url: null, source: "none" };
}

// ---------------------------------------------------------------------------
// Library picker w/ exclusion + LRU repeat fallback
// ---------------------------------------------------------------------------

async function pickFromCandidates(
  candidates: MediaLibraryRow[],
  excludedFromRecency: Set<string>,
  recentRefs: string[],
  postContent: string,
  hashtags: string[],
  // Always "library" right now; reserved param so a future caller can
  // tag the source for analytics without changing the call signature.
  baseSource: "library",
): Promise<AutoAttachResult> {
  if (candidates.length === 0) {
    console.log("[media/autoSelect] empty candidate set → text-only", {
      base_source: baseSource,
    });
    return { media_id: null, image_url: null, source: "none" };
  }

  const fresh = candidates.filter((m) => !excludedFromRecency.has(m.id));
  if (fresh.length > 0) {
    const picked = await selectFromLibrary(postContent, hashtags, fresh);
    if (picked) {
      console.log("[media/autoSelect] selected fresh from candidates", {
        media_id: picked.id,
        base_source: baseSource,
        candidate_count: candidates.length,
        fresh_count: fresh.length,
      });
      return {
        media_id: picked.id,
        image_url: picked.public_url,
        source: baseSource,
      };
    }
    // Selector picked none even though we had fresh candidates — fall
    // through to LRU on the full set.
  }

  // (3) LRU repeat: exclusion emptied OR selector punted. Pick the
  // image that appears LAST in recentRefs (least-recently-used). If
  // none of the candidates appear in recentRefs at all, prefer those
  // (never-used > stale-used).
  const lastUsedIndex = new Map<string, number>();
  recentRefs.forEach((id, i) => {
    if (!lastUsedIndex.has(id)) lastUsedIndex.set(id, i);
  });
  // Smaller index = more recent. Larger / missing = older / never.
  const lruSorted = [...candidates].sort((a, b) => {
    const ai = lastUsedIndex.get(a.id) ?? Number.POSITIVE_INFINITY;
    const bi = lastUsedIndex.get(b.id) ?? Number.POSITIVE_INFINITY;
    return bi - ai; // descending → least-recently-used first
  });
  const picked = lruSorted[0];
  console.log("[media/autoSelect] LRU repeat (pool too small / quota out)", {
    media_id: picked.id,
    base_source: baseSource,
    candidate_count: candidates.length,
    last_used_index_of_pick: lastUsedIndex.get(picked.id) ?? "never",
  });
  return {
    media_id: picked.id,
    image_url: picked.public_url,
    // Tag as a repeat for downstream logging / future analytics.
    source: "library_lru_repeat",
  };
}

// ---------------------------------------------------------------------------
// Gemini generation w/ plan + quota gates
// ---------------------------------------------------------------------------

async function tryGeminiGenerate(opts: {
  client: Client;
  userId: string;
  aiConfigId: string | null;
  postContent: string;
  hashtags: string[];
  topicTags: string[];
  pillar: ContentPillar | null;
  recentDescriptions: string[];
  reason: "pool_buildup" | "cold_start";
  currentPoolSize: number;
}): Promise<AutoAttachResult | null> {
  const {
    client,
    userId,
    aiConfigId,
    postContent,
    hashtags,
    topicTags,
    pillar,
    recentDescriptions,
    reason,
    currentPoolSize,
  } = opts;

  const { data: profile } = await client
    .from("profiles")
    .select(
      "plan, ai_images_used_this_period, ai_images_period_start, current_period_start",
    )
    .eq("id", userId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  if (!isPaidPlan(plan)) {
    console.log("[media/autoSelect] Gemini skipped — plan=free", {
      user_id: userId,
      reason,
    });
    return null;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn("[media/autoSelect] Gemini skipped — GEMINI_API_KEY missing");
    return null;
  }

  const limit = getPlanLimits(plan).ai_images_per_month;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const wantStartIso =
    profile?.current_period_start ?? monthStart.toISOString();
  const recordedStart = profile?.ai_images_period_start ?? null;
  let used = profile?.ai_images_used_this_period ?? 0;
  if (!recordedStart || new Date(recordedStart) < new Date(wantStartIso)) {
    await client
      .from("profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        ai_images_used_this_period: 0,
        ai_images_period_start: wantStartIso,
      } as any)
      .eq("id", userId);
    used = 0;
  }
  if (used >= limit) {
    console.log("[media/autoSelect] Gemini skipped — quota out", {
      user_id: userId,
      plan,
      used,
      limit,
      reason,
    });
    return null;
  }

  console.log("[media/autoSelect] Gemini ENGAGED", {
    user_id: userId,
    ai_config_id: aiConfigId,
    plan,
    used,
    limit,
    reason,
    pool_size: currentPoolSize,
    pool_target: TARGET_POOL_SIZE,
  });

  const prompt = buildImagePromptFromPost(postContent, topicTags, hashtags, {
    pillar,
    recentImageDescriptions: recentDescriptions,
  });

  let media: MediaLibraryRow;
  try {
    media = await generateAiImageForUser(client, userId, aiConfigId, prompt);
  } catch (e) {
    if (e instanceof GeminiGenerationError) {
      console.error("[media/autoSelect] Gemini FAILED", {
        status: e.status,
        message: e.message,
      });
    } else {
      console.error("[media/autoSelect] Gemini FAILED (unknown)", e);
    }
    return null;
  }

  await client
    .from("profiles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ ai_images_used_this_period: used + 1 } as any)
    .eq("id", userId);

  console.log("[media/autoSelect] Gemini SUCCESS", {
    media_id: media.id,
    new_used: used + 1,
    limit,
  });

  return {
    media_id: media.id,
    image_url: media.public_url,
    source: "ai_generated",
  };
}
