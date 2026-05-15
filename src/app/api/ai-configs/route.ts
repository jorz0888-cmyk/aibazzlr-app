import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAiConfig, setDefaultAiConfig } from "@/lib/db/ai-configs";
import { applyAiConfigDefaults } from "@/lib/db/ai-config-defaults";
import { extractDbError } from "@/lib/db/error";
import { toStringArray } from "@/lib/ai/normalize-extracted";
import type { AiConfigInsert } from "@/lib/supabase/types";
import {
  checkAiConfigQuota,
  aiConfigQuotaExceededResponse,
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

  // Phase 9: enforce plan-based AI-config limit (Free=1, Standard=3, Premium=∞).
  const quota = await checkAiConfigQuota(user.id);
  if (!quota.allowed) return aiConfigQuotaExceededResponse(quota);

  const body = await request.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  if (!name || name.length > 30) {
    return NextResponse.json(
      { error: "名前は1〜30文字で入力してください" },
      { status: 400 },
    );
  }

  const insert: AiConfigInsert = applyAiConfigDefaults({
    user_id: user.id,
    name,
    industry: body.industry ?? null,
    business_name: body.business_name ?? null,
    business_description: body.business_description ?? null,
    persona_role: body.persona_role ?? null,
    world_view: body.world_view ?? null,
    voice_tone: body.voice_tone ?? null,
    target_audience: body.target_audience ?? null,
    ng_words: toStringArray(body.ng_words),
    must_include_elements: toStringArray(body.must_include_elements),
    good_examples: toStringArray(body.good_examples),
    bad_examples: toStringArray(body.bad_examples),
    hashtag_pool: toStringArray(body.hashtag_pool),
    hashtags_per_post:
      typeof body.hashtags_per_post === "number"
        ? body.hashtags_per_post
        : undefined,
    posting_frequency: body.posting_frequency ?? undefined,
    posting_times: body.posting_times ?? undefined,
    social_account_ids: Array.isArray(body.social_account_ids)
      ? body.social_account_ids
      : undefined,
    generated_system_prompt: body.generated_system_prompt ?? null,
    requires_approval:
      typeof body.requires_approval === "boolean"
        ? body.requires_approval
        : undefined,
    // Phase 5.8 fields
    account_mode: body.account_mode ?? undefined,
    business_hours: body.business_hours ?? null,
    closed_days: body.closed_days ?? null,
    address: body.address ?? null,
    price_range: body.price_range ?? null,
    menu_items: toStringArray(body.menu_items),
    seasonal_items: toStringArray(body.seasonal_items),
    real_episodes: toStringArray(body.real_episodes),
    announcement_topics: toStringArray(body.announcement_topics),
  });

  try {
    const config = await createAiConfig(supabase, insert);
    if (body.is_default) {
      await setDefaultAiConfig(supabase, config.id, user.id);
    }
    return NextResponse.json({ id: config.id });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[AI-CONFIGS-CREATE-FAILURE]", {
      userId: user.id,
      errorCode: info.code,
      errorMessage: info.message,
      errorDetails: info.details,
      errorHint: info.hint,
      insertedFields: Object.keys(insert),
      nullFields: Object.entries(insert)
        .filter(([, v]) => v === null || v === undefined)
        .map(([k]) => k),
      userIdProvided: !!insert.user_id,
    });
    return NextResponse.json(
      {
        error: "AI設定の作成に失敗しました",
        debug: info,
      },
      { status: 500 },
    );
  }
}
