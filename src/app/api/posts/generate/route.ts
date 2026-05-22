import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { getSocialAccountById } from "@/lib/db/social-accounts";
import { extractDbError } from "@/lib/db/error";
import { applyPostDefaults } from "@/lib/db/post-defaults";
import { generatePostDraft } from "@/lib/posts/generator";
import { autoAttachLibraryImage } from "@/lib/media/autoSelect";
import { recordTopicTags } from "@/lib/strategy/topic-tracking";
import type { Platform } from "@/lib/supabase/types";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import {
  checkMonthlyPostQuota,
  monthlyQuotaExceededResponse,
} from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phase 7.5a: Rate limit + daily quota guards
  const rateResult = await checkRateLimit(user.id);
  if (!rateResult.success) return rateLimitedResponse(rateResult);

  // Phase 9: monthly post quota tied to plan (Free=10, Standard=150, Premium=450).
  const quotaResult = await checkMonthlyPostQuota(user.id);
  if (!quotaResult.allowed) return monthlyQuotaExceededResponse(quotaResult);

  const body = (await request.json().catch(() => ({}))) as {
    ai_config_id?: string;
    social_account_id?: string;
    theme?: string;
  };

  if (!body.ai_config_id || !body.social_account_id) {
    return NextResponse.json(
      { error: "ai_config_id と social_account_id は必須です" },
      { status: 400 },
    );
  }

  // Verify ownership of both resources
  const aiConfig = await getAiConfigById(supabase, body.ai_config_id);
  if (!aiConfig || aiConfig.user_id !== user.id) {
    return NextResponse.json(
      { error: "AI設定が見つかりません" },
      { status: 404 },
    );
  }

  const account = await getSocialAccountById(supabase, body.social_account_id);
  if (!account || account.user_id !== user.id) {
    return NextResponse.json(
      { error: "投稿先アカウントが見つかりません" },
      { status: 404 },
    );
  }
  if (account.status !== "active") {
    return NextResponse.json(
      { error: `投稿先アカウントが利用不可状態です（${account.status}）` },
      { status: 409 },
    );
  }

  // Phase 11.5: gather the last 10 opening snippets for this AI config so
  // the generator can avoid repeating openings. Best-effort — empty array
  // on any read failure.
  const { data: recentOpeningsRows } = await supabase
    .from("posts")
    .select("opening_snippet")
    .eq("ai_config_id", aiConfig.id)
    .not("opening_snippet", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  const recentOpenings = (recentOpeningsRows ?? [])
    .map((r) => r.opening_snippet)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  // 1. Generate via Claude
  let generated;
  try {
    generated = await generatePostDraft(aiConfig, body.theme, {
      recentOpenings,
    });
  } catch (e) {
    console.error("[POSTS-GENERATE] AI failure", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "AI生成に失敗しました",
      },
      { status: 502 },
    );
  }

  // 2a. Phase 12 / Diagnosis 2026-05-21: library lookup with Gemini
  //     fallback when library is empty + plan is paid + image quota
  //     remains + GEMINI_API_KEY is set. Fail-soft to text-only.
  const picked = await autoAttachLibraryImage(
    supabase,
    user.id,
    aiConfig.id,
    generated.content,
    generated.hashtags,
    generated.topic_tags,
    { imageGenerationEnabled: aiConfig.image_generation_enabled },
  );
  console.log("[POSTS-GENERATE] image attach result", {
    user_id: user.id,
    source: picked.source,
    media_id: picked.media_id,
  });

  // 2b. Persist as draft. applyPostDefaults fills in NOT-NULL columns
  //     (status, scheduled_at, hashtags, platform, engagement_data,
  //     generation_metadata, retry_count) so a missing DB default never
  //     triggers a 23502 here.
  const insertPayload = applyPostDefaults({
    user_id: user.id,
    ai_config_id: aiConfig.id,
    social_account_id: account.id,
    platform: account.platform as Platform,
    content: generated.content,
    hashtags: generated.hashtags,
    theme: generated.theme,
    generation_metadata: generated.metadata,
    media_id: picked.media_id,
    image_url: picked.image_url,
    strategic_intent: generated.strategic_intent,
    topic_tags: generated.topic_tags,
    opening_snippet: generated.opening_snippet,
  });

  const { data, error } = await supabase
    .from("posts")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    const info = extractDbError(error);
    console.error("[POSTS-API/generate] insert failed", info);
    return NextResponse.json(
      { error: `下書きの保存に失敗しました: ${info.message}`, debug: info },
      { status: 500 },
    );
  }

  // Phase 13: bookkeeping — record the new topic tags on the AI config so
  // the next generation knows what to avoid. Fail-soft inside the helper.
  if (generated.topic_tags.length > 0) {
    void recordTopicTags(supabase, aiConfig.id, generated.topic_tags);
  }

  return NextResponse.json({ post: data });
}
