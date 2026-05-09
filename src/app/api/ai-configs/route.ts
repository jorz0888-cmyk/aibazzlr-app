import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAiConfig, setDefaultAiConfig } from "@/lib/db/ai-configs";
import type { AiConfigInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  if (!name || name.length > 30) {
    return NextResponse.json(
      { error: "名前は1〜30文字で入力してください" },
      { status: 400 },
    );
  }

  const insert: AiConfigInsert = {
    user_id: user.id,
    name,
    is_default: false,
    status: "active",
    industry: body.industry ?? null,
    business_name: body.business_name ?? null,
    business_description: body.business_description ?? null,
    persona_role: body.persona_role ?? null,
    world_view: body.world_view ?? null,
    voice_tone: body.voice_tone ?? null,
    target_audience: body.target_audience ?? null,
    ng_words: Array.isArray(body.ng_words) ? body.ng_words : [],
    must_include_elements: Array.isArray(body.must_include_elements)
      ? body.must_include_elements
      : [],
    good_examples: Array.isArray(body.good_examples) ? body.good_examples : [],
    bad_examples: Array.isArray(body.bad_examples) ? body.bad_examples : [],
    hashtag_pool: Array.isArray(body.hashtag_pool) ? body.hashtag_pool : [],
    hashtags_per_post:
      typeof body.hashtags_per_post === "number" ? body.hashtags_per_post : 3,
    posting_frequency: body.posting_frequency ?? null,
    posting_times: body.posting_times ?? null,
    social_account_ids: Array.isArray(body.social_account_ids)
      ? body.social_account_ids
      : [],
    generated_system_prompt: body.generated_system_prompt ?? null,
    requires_approval:
      typeof body.requires_approval === "boolean"
        ? body.requires_approval
        : true,
  };

  try {
    const config = await createAiConfig(supabase, insert);
    if (body.is_default) {
      await setDefaultAiConfig(supabase, config.id, user.id);
    }
    return NextResponse.json({ id: config.id });
  } catch (e) {
    const code = (e as { code?: string }).code ?? null;
    const message = e instanceof Error ? e.message : String(e);
    const hint = (e as { hint?: string }).hint ?? null;
    const details = (e as { details?: string }).details ?? null;
    console.error("[ai-configs/POST]", { code, message, hint, details });
    return NextResponse.json(
      {
        error: "AI設定の作成に失敗しました",
        debug: { code, message, hint, details },
      },
      { status: 500 },
    );
  }
}
