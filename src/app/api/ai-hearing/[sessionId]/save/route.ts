import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import {
  createAiConfig,
  getAiConfigById,
  setDefaultAiConfig,
  updateAiConfig,
} from "@/lib/db/ai-configs";
import { applyAiConfigDefaults } from "@/lib/db/ai-config-defaults";
import { extractDbError } from "@/lib/db/error";
import {
  normalizeExtractedData,
  toStringArray,
} from "@/lib/ai/normalize-extracted";
import {
  normalizeAccountMode,
  type AiConfigInsert,
  type AiConfigUpdate,
  type ExtractedHearingData,
} from "@/lib/supabase/types";
import {
  aiConfigQuotaExceededResponse,
  checkAiConfigQuota,
} from "@/lib/quota";

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

    // 2026-05-23 T1: prefer to ACTIVATE the auto-saved draft instead
    // of inserting a duplicate row. finalize creates one draft per
    // session and links it via session.ai_config_id, so by the time
    // the user clicks "有効化" there's almost always an existing row
    // to flip.
    const existingDraft =
      session.ai_config_id
        ? await getAiConfigById(supabase, session.ai_config_id)
        : null;
    const willActivate = existingDraft?.status !== "active";

    // Quota enforced only on the active-flip — drafts are exempt
    // (matches checkAiConfigQuota change in src/lib/quota.ts).
    if (willActivate) {
      const quota = await checkAiConfigQuota(userId);
      if (!quota.allowed) {
        return aiConfigQuotaExceededResponse(quota);
      }
    }

    if (existingDraft && existingDraft.user_id === userId) {
      // UPDATE the draft with the (possibly user-edited) data and flip
      // it to active. We deliberately preserve fields the activate
      // flow doesn't touch (posting_frequency / posting_times /
      // social_account_ids / etc.) so any edits from the AI設定詳細
      // page survive a re-activate.
      const patch: AiConfigUpdate = {
        name: insert.name,
        account_mode: insert.account_mode,
        industry: insert.industry,
        business_name: insert.business_name,
        business_description: insert.business_description,
        persona_role: insert.persona_role,
        world_view: insert.world_view,
        voice_tone: insert.voice_tone,
        target_audience: insert.target_audience,
        ng_words: insert.ng_words,
        must_include_elements: insert.must_include_elements,
        good_examples: insert.good_examples,
        bad_examples: insert.bad_examples,
        hashtag_pool: insert.hashtag_pool,
        generated_system_prompt: insert.generated_system_prompt,
        business_hours: insert.business_hours,
        closed_days: insert.closed_days,
        address: insert.address,
        price_range: insert.price_range,
        menu_items: insert.menu_items,
        seasonal_items: insert.seasonal_items,
        real_episodes: insert.real_episodes,
        announcement_topics: insert.announcement_topics,
        status: "active",
      };
      await updateAiConfig(supabase, existingDraft.id, patch);
      configId = existingDraft.id;
    } else {
      // No draft (e.g. session created before the auto-draft fix) →
      // INSERT fresh. Force status='active' since this is an explicit
      // user activation.
      const insertForActivate: AiConfigInsert = { ...insert, status: "active" };
      const config = await createAiConfig(supabase, insertForActivate);
      configId = config.id;
    }

    if (body.is_default) {
      await setDefaultAiConfig(supabase, configId, userId);
    }

    await updateHearingSession(supabase, sessionId, {
      ai_config_id: configId,
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
