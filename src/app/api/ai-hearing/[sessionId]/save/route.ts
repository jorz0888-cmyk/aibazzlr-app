import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { createAiConfig, setDefaultAiConfig } from "@/lib/db/ai-configs";
import type { AiConfigInsert, ExtractedHearingData } from "@/lib/supabase/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ sessionId: string }> };

type SaveBody = {
  name?: string;
  is_default?: boolean;
  prompt_overrides?: Partial<ExtractedHearingData> & {
    finalized_prompt?: string;
  };
};

/**
 * POST /api/ai-hearing/[sessionId]/save
 *
 * Persist the (possibly user-edited) hearing result into ai_configs and
 * link it back to the hearing session.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!session.extracted_data || !session.finalized_prompt) {
    return NextResponse.json(
      { error: "Session is not finalized yet" },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as SaveBody;

  // Merge user-edited fields on top of the AI extraction.
  const data: ExtractedHearingData = {
    ...session.extracted_data,
    ...(body.prompt_overrides ?? {}),
  };

  const finalizedPrompt =
    body.prompt_overrides?.finalized_prompt ?? session.finalized_prompt;

  const insert: AiConfigInsert = {
    user_id: user.id,
    name: body.name?.trim() || data.business_name?.trim() || "新しいAI設定",
    is_default: false,
    status: "active",
    industry: data.industry ?? session.industry ?? null,
    business_name: data.business_name ?? null,
    business_description: data.business_description ?? null,
    persona_role: data.persona_role ?? null,
    world_view: data.world_view ?? null,
    voice_tone: data.voice_tone ?? null,
    target_audience: data.target_audience ?? null,
    ng_words: data.ng_words ?? [],
    must_include_elements: data.must_include_elements ?? [],
    good_examples: data.good_examples ?? [],
    bad_examples: [],
    hashtag_pool: data.hashtag_pool ?? [],
    hashtags_per_post: 3,
    posting_frequency: null,
    posting_times: null,
    social_account_ids: [],
    generated_system_prompt: finalizedPrompt,
    requires_approval: true,
  };

  let configId: string;
  try {
    const config = await createAiConfig(supabase, insert);
    configId = config.id;

    if (body.is_default) {
      await setDefaultAiConfig(supabase, config.id, user.id);
    }

    await updateHearingSession(supabase, sessionId, {
      ai_config_id: config.id,
      status: "completed",
    });
  } catch (e) {
    console.error("[hearing/save]", e);
    return NextResponse.json(
      { error: "AI設定の保存に失敗しました" },
      { status: 500 },
    );
  }

  return NextResponse.json({ aiConfigId: configId });
}
