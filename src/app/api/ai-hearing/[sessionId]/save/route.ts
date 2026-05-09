import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { createAiConfig, setDefaultAiConfig } from "@/lib/db/ai-configs";
import { normalizeExtractedData } from "@/lib/ai/normalize-extracted";
import {
  normalizeAccountMode,
  type AiConfigInsert,
  type ExtractedHearingData,
} from "@/lib/supabase/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ sessionId: string }> };

type SaveBody = {
  name?: string;
  is_default?: boolean;
  prompt_overrides?: Partial<ExtractedHearingData> & {
    /** Renamed from `finalized_prompt` to match production DB schema. */
    generated_system_prompt?: string;
    /** @deprecated Old client name; still accepted for back-compat. */
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
  if (!session.extracted_data || !session.generated_system_prompt) {
    return NextResponse.json(
      { error: "Session is not finalized yet" },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as SaveBody;

  // Merge user-edited fields on top of the AI extraction, then normalize.
  // Normalize coerces stray strings into arrays etc., so that DB writes
  // (text[] columns) don't fail when the AI returns "A、B" as a string.
  const merged = {
    ...session.extracted_data,
    ...(body.prompt_overrides ?? {}),
  };
  const data: ExtractedHearingData = normalizeExtractedData(
    merged,
    normalizeAccountMode(session.account_mode),
  );

  const finalizedPrompt =
    body.prompt_overrides?.generated_system_prompt ??
    body.prompt_overrides?.finalized_prompt ??
    session.generated_system_prompt;

  // Resolve account_mode: extracted > session > default('real')
  const accountMode = normalizeAccountMode(
    data.account_mode ?? session.account_mode,
  );

  const ensureArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const insert: AiConfigInsert = {
    user_id: user.id,
    name: body.name?.trim() || data.business_name?.trim() || "新しいAI設定",
    is_default: false,
    status: "active",
    account_mode: accountMode,
    industry: data.industry ?? session.industry ?? null,
    business_name: data.business_name ?? null,
    business_description: data.business_description ?? null,
    persona_role: data.persona_role ?? null,
    world_view: data.world_view ?? null,
    voice_tone: data.voice_tone ?? null,
    target_audience: data.target_audience ?? null,
    ng_words: ensureArray(data.ng_words),
    must_include_elements: ensureArray(data.must_include_elements),
    good_examples: ensureArray(data.good_examples),
    bad_examples: [],
    hashtag_pool: ensureArray(data.hashtag_pool),
    hashtags_per_post: 3,
    posting_frequency: null,
    posting_times: null,
    social_account_ids: [],
    generated_system_prompt: finalizedPrompt,
    requires_approval: true,
    // Real-mode-only fields (safe to send for fictional too — DB defaults to '' / [])
    business_hours: data.business_hours ?? null,
    closed_days: data.closed_days ?? null,
    address: data.address ?? null,
    price_range: data.price_range ?? null,
    menu_items: ensureArray(data.menu_items),
    seasonal_items: ensureArray(data.seasonal_items),
    real_episodes: ensureArray(data.real_episodes),
    announcement_topics: ensureArray(data.announcement_topics),
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
