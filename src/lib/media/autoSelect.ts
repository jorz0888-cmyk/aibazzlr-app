import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentPillar,
  Database,
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

export type AutoAttachSource = "library" | "ai_generated" | "none";

export type AutoAttachResult = {
  media_id: string | null;
  image_url: string | null;
  source: AutoAttachSource;
};

/**
 * Resolve a post image for both manual and cron-triggered draft
 * generation. Tries, in order:
 *   0. (Phase 16) Skip entirely when image_generation_enabled=false on
 *      the config — caller explicitly opted out of image attachment.
 *   1. Library lookup (Claude picks the best fit if any candidates).
 *   2. Gemini fallback — only for paid plans, only if quota remains,
 *      only if GEMINI_API_KEY is configured. Increments the period's
 *      AI image counter on success.
 *   3. Returns "none" — caller posts text-only (fail-soft).
 *
 * Caller-supplied logging context (post id is not yet known here, so
 * we log via user_id + ai_config_id). All branches log so cron output
 * shows exactly which path was taken.
 */
export async function autoAttachLibraryImage(
  client: Client,
  userId: string,
  aiConfigId: string | null,
  postContent: string,
  hashtags: string[],
  topicTags: string[] = [],
  options: {
    imageGenerationEnabled?: boolean;
    /** Phase 17: pillar threaded into the Gemini prompt for an angle hint. */
    pillar?: ContentPillar | null;
  } = {},
): Promise<AutoAttachResult> {
  // ----- 0. Per-config opt-out -------------------------------------------
  if (options.imageGenerationEnabled === false) {
    console.log(
      "[media/autoSelect] image attach skipped — image_generation_enabled is OFF",
      { user_id: userId, ai_config_id: aiConfigId },
    );
    return { media_id: null, image_url: null, source: "none" };
  }

  // ----- (shared) Recent image refs for anti-repeat ----------------------
  // We need this for BOTH the library exclusion AND the Gemini "do not
  // look like these" hint. One read covers both.
  let recentImageRefs: string[] = [];
  let recentImageDescriptions: string[] = [];
  if (aiConfigId) {
    const { data: recentPosts } = await client
      .from("posts")
      .select("image_ref")
      .eq("ai_config_id", aiConfigId)
      .not("image_ref", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    recentImageRefs = (recentPosts ?? [])
      .map((p) => p.image_ref)
      .filter((x): x is string => typeof x === "string" && x.length > 0);

    const referencedMediaIds = recentImageRefs.filter(
      (x) => x !== "generated",
    );
    if (referencedMediaIds.length > 0) {
      const { data: descs } = await client
        .from("media_library")
        .select("id, ai_description, tags")
        .in("id", referencedMediaIds);
      const descMap = new Map<string, string>();
      for (const d of descs ?? []) {
        const desc =
          (typeof d.ai_description === "string" && d.ai_description) ||
          (Array.isArray(d.tags) ? d.tags.join(", ") : "");
        if (desc) descMap.set(d.id, desc);
      }
      recentImageDescriptions = referencedMediaIds
        .map((id) => descMap.get(id))
        .filter((s): s is string => Boolean(s));
    }
  }

  // ----- 1. Library lookup ------------------------------------------------
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
  // Phase 17: exclude images used in the last 10 posts so library picks
  // rotate. If the exclusion empties the candidate set entirely (small
  // library), we fall back to using everything — better an old repeat
  // than nothing.
  const usedIds = new Set(
    recentImageRefs.filter((x) => x !== "generated"),
  );
  let candidates = rawCandidates.filter((m) => !usedIds.has(m.id));
  if (candidates.length === 0 && rawCandidates.length > 0) {
    console.log(
      "[media/autoSelect] anti-repeat would empty the library — picking from full set",
      { user_id: userId, ai_config_id: aiConfigId, library_size: rawCandidates.length },
    );
    candidates = rawCandidates;
  }
  console.log("[media/autoSelect] library candidates", {
    user_id: userId,
    ai_config_id: aiConfigId,
    raw_count: rawCandidates.length,
    after_exclusion: candidates.length,
    recent_image_refs: recentImageRefs.length,
  });

  if (candidates.length > 0) {
    const picked = await selectFromLibrary(postContent, hashtags, candidates);
    if (picked) {
      console.log("[media/autoSelect] selected from library", {
        media_id: picked.id,
        tags: picked.tags,
      });
      return {
        media_id: picked.id,
        image_url: picked.public_url,
        source: "library",
      };
    }
    console.log(
      "[media/autoSelect] library had candidates but selector picked none — falling through to AI fallback",
    );
  }

  // ----- 2. Gemini fallback ----------------------------------------------
  const fallback = await tryAiFallback(
    client,
    userId,
    aiConfigId,
    postContent,
    topicTags,
    hashtags,
    options.pillar ?? null,
    recentImageDescriptions,
  );
  if (fallback) return fallback;

  // ----- 3. Text-only fail-soft ------------------------------------------
  console.log("[media/autoSelect] no image attached (fail-soft text-only)");
  return { media_id: null, image_url: null, source: "none" };
}

async function tryAiFallback(
  client: Client,
  userId: string,
  aiConfigId: string | null,
  postContent: string,
  topicTags: string[],
  hashtags: string[],
  pillar: ContentPillar | null,
  recentImageDescriptions: string[],
): Promise<AutoAttachResult | null> {
  // a. Plan gate.
  const { data: profile } = await client
    .from("profiles")
    .select(
      "plan, ai_images_used_this_period, ai_images_period_start, current_period_start",
    )
    .eq("id", userId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  if (!isPaidPlan(plan)) {
    console.log(
      "[media/autoSelect] Gemini fallback skipped — plan is free (image generation is a paid feature)",
      { user_id: userId, plan },
    );
    return null;
  }

  // b. API key gate.
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "[media/autoSelect] Gemini fallback skipped — GEMINI_API_KEY not configured",
    );
    return null;
  }

  // c. Quota gate. We do an inline read+reset of the counter rather than
  //    calling checkMonthlyImageQuota() because that helper uses the
  //    server (RLS) client and we want to behave the same whether called
  //    from a cron admin client or a user-scoped server client.
  const limit = getPlanLimits(plan).ai_images_per_month;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Paid plans align to the Stripe billing cycle when known.
  const wantStartIso =
    profile?.current_period_start ?? monthStart.toISOString();
  const recordedStart = profile?.ai_images_period_start ?? null;

  let used = profile?.ai_images_used_this_period ?? 0;
  if (!recordedStart || new Date(recordedStart) < new Date(wantStartIso)) {
    // Period rollover — reset.
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
    console.log(
      "[media/autoSelect] Gemini fallback skipped — image quota exhausted",
      { user_id: userId, plan, used, limit },
    );
    return null;
  }

  console.log("[media/autoSelect] Gemini fallback ENGAGED", {
    user_id: userId,
    ai_config_id: aiConfigId,
    plan,
    used,
    limit,
  });

  // d. Generate. Phase 17: thread the selected pillar + recent image
  //    descriptions into the Gemini prompt so the generator has
  //    enough context to make visually distinct output.
  const prompt = buildImagePromptFromPost(postContent, topicTags, hashtags, {
    pillar,
    recentImageDescriptions,
  });
  let media: MediaLibraryRow;
  try {
    media = await generateAiImageForUser(client, userId, aiConfigId, prompt);
  } catch (e) {
    if (e instanceof GeminiGenerationError) {
      console.error("[media/autoSelect] Gemini fallback FAILED", {
        status: e.status,
        message: e.message,
      });
    } else {
      console.error("[media/autoSelect] Gemini fallback FAILED (unknown)", e);
    }
    return null;
  }

  // e. Increment usage counter.
  await client
    .from("profiles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ ai_images_used_this_period: used + 1 } as any)
    .eq("id", userId);

  console.log("[media/autoSelect] Gemini fallback SUCCESS", {
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
