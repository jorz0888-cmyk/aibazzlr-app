import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { getSocialAccountById } from "@/lib/db/social-accounts";
import { extractDbError } from "@/lib/db/error";
import { applyPostDefaults } from "@/lib/db/post-defaults";
import { generatePostDraft } from "@/lib/posts/generator";
import type { Platform } from "@/lib/supabase/types";

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

  // 1. Generate via Claude
  let generated;
  try {
    generated = await generatePostDraft(aiConfig, body.theme);
  } catch (e) {
    console.error("[POSTS-GENERATE] AI failure", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "AI生成に失敗しました",
      },
      { status: 502 },
    );
  }

  // 2. Persist as draft. applyPostDefaults fills in NOT-NULL columns
  //    (status, scheduled_at, hashtags, platform, engagement_data,
  //    generation_metadata, retry_count) so a missing DB default never
  //    triggers a 23502 here.
  const insertPayload = applyPostDefaults({
    user_id: user.id,
    ai_config_id: aiConfig.id,
    social_account_id: account.id,
    platform: account.platform as Platform,
    content: generated.content,
    hashtags: generated.hashtags,
    theme: generated.theme,
    generation_metadata: generated.metadata,
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

  return NextResponse.json({ post: data });
}
