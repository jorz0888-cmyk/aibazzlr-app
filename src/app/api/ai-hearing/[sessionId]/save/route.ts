import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { createAiConfig, setDefaultAiConfig } from "@/lib/db/ai-configs";
import { applyAiConfigDefaults } from "@/lib/db/ai-config-defaults";
import { extractDbError } from "@/lib/db/error";
import {
  normalizeExtractedData,
  toStringArray,
} from "@/lib/ai/normalize-extracted";
import {
  normalizeAccountMode,
  type AiConfigInsert,
  type ExtractedHearingData,
} from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user || !user.id) {
    console.error("[hearing/save] auth missing", { authError });
    return NextResponse.json(
      {
        error:
          "認証セッションを取得できませんでした。再度ログインしてからお試しください。",
      },
      { status: 401 },
    );
  }

  // user_id is taken strictly from the verified server-side session, never
  // from the request body. Used unconditionally below.
  const userId = user.id;

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== userId) {
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

  // Build the raw payload; pass through applyAiConfigDefaults so any field
  // that's NOT NULL in production (posting_frequency, posting_times, etc.)
  // gets a safe default if upstream code didn't supply one.
  const insert: AiConfigInsert = applyAiConfigDefaults({
    user_id: userId, // ← strictly from verified server session
    name: body.name?.trim() || data.business_name?.trim() || "新しいAI設定",
    account_mode: accountMode,
    industry: data.industry ?? session.industry ?? null,
    business_name: data.business_name ?? null,
    business_description: data.business_description ?? null,
    persona_role: data.persona_role ?? null,
    world_view: data.world_view ?? null,
    voice_tone: data.voice_tone ?? null,
    target_audience: data.target_audience ?? null,
    ng_words: toStringArray(data.ng_words),
    must_include_elements: toStringArray(data.must_include_elements),
    good_examples: toStringArray(data.good_examples),
    bad_examples: [],
    hashtag_pool: toStringArray(data.hashtag_pool),
    generated_system_prompt: finalizedPrompt,
    // Real-mode-only fields (safe to send for fictional too — DB defaults to '' / [])
    business_hours: data.business_hours ?? null,
    closed_days: data.closed_days ?? null,
    address: data.address ?? null,
    price_range: data.price_range ?? null,
    menu_items: toStringArray(data.menu_items),
    seasonal_items: toStringArray(data.seasonal_items),
    real_episodes: toStringArray(data.real_episodes),
    announcement_topics: toStringArray(data.announcement_topics),
    // is_default / status / posting_frequency / posting_times /
    // social_account_ids / requires_approval / hashtags_per_post are all
    // filled in by applyAiConfigDefaults when missing.
  });

  let configId: string;
  try {
    // Defensive: blow up loudly here if user_id slipped through. Better than
    // a Postgres NOT NULL error that surfaces as "[object Object]".
    if (!insert.user_id) {
      throw new Error(
        "Internal: insert.user_id is missing despite an authorized session",
      );
    }
    const config = await createAiConfig(supabase, insert);
    configId = config.id;

    if (body.is_default) {
      await setDefaultAiConfig(supabase, config.id, userId);
    }

    await updateHearingSession(supabase, sessionId, {
      ai_config_id: config.id,
      status: "completed",
    });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[AI-CONFIGS-SAVE-FAILURE]", {
      sessionId,
      userId,
      errorCode: info.code,
      errorMessage: info.message,
      errorDetails: info.details,
      errorHint: info.hint,
      insertedFields: Object.keys(insert),
      nullFields: Object.entries(insert)
        .filter(([, v]) => v === null || v === undefined)
        .map(([k]) => k),
      userIdProvided: !!insert.user_id,
      arrayFieldsRaw: {
        menu_items_type: typeof (data.menu_items?.[0] as unknown),
        menu_items_sample: data.menu_items?.[0],
        seasonal_items_type: typeof (data.seasonal_items?.[0] as unknown),
        seasonal_items_sample: data.seasonal_items?.[0],
      },
      normalizedFields: {
        menu_items: insert.menu_items,
        seasonal_items: insert.seasonal_items,
        ng_words: insert.ng_words,
      },
    });
    return NextResponse.json(
      {
        error: "AI設定の保存に失敗しました",
        debug_save: info,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ aiConfigId: configId });
}
