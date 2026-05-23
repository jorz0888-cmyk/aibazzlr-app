import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { getAnthropic, FINALIZE_MODEL } from "@/lib/ai/anthropic";
import { interviewerPromptFor } from "@/lib/ai/hearing-prompts";
import {
  buildSystemPromptForMode,
  tryExtractFinalJson,
} from "@/lib/ai/v14-builder";
import { normalizeExtractedData } from "@/lib/ai/normalize-extracted";
import {
  normalizeAccountMode,
  type AccountMode,
  type AiConfigInsert,
  type AiConfigUpdate,
  type ExtractedHearingData,
  type HearingMessage,
} from "@/lib/supabase/types";
import { applyAiConfigDefaults } from "@/lib/db/ai-config-defaults";
import {
  createAiConfig,
  getAiConfigById,
  updateAiConfig,
} from "@/lib/db/ai-configs";
import { toStringArray } from "@/lib/ai/normalize-extracted";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ sessionId: string }> };

const FINALIZE_INSTRUCTION_REAL = `ここまでの会話を踏まえて、システムプロンプト用の構造化データを必ず以下のフォーマットで出力してください。

【出力ルール（厳守）】
- 余計な前置き・後置きの文章は書かない
- 一番外側を \`\`\`json と \`\`\` で囲む
- 値が分からない項目は空文字 "" や空配列 [] で埋める
- 配列要素は分かる範囲で埋める（足りなくても OK）
- "complete": true / "account_mode": "real" / "name" を必ず含める
- JSONを途中で切らない（必ず閉じカッコ \`}\` まで）

\`\`\`json
{
  "complete": true,
  "account_mode": "real",
  "name": "",
  "industry": "",
  "business_name": "",
  "business_description": "",
  "business_hours": "",
  "closed_days": "",
  "address": "",
  "price_range": "",
  "menu_items": [],
  "seasonal_items": [],
  "real_episodes": [],
  "announcement_topics": [],
  "persona_role": "",
  "voice_tone": "casual_polite",
  "target_audience": "",
  "world_view": "",
  "must_include_elements": [],
  "good_examples": [],
  "ng_words": [],
  "hashtag_pool": [],
  "summary_message": ""
}
\`\`\``;

const FINALIZE_INSTRUCTION_FICTIONAL = `ここまでの会話を踏まえて、システムプロンプト用の構造化データを必ず以下のフォーマットで出力してください。

【出力ルール（厳守）】
- 余計な前置き・後置きの文章は書かない
- 一番外側を \`\`\`json と \`\`\` で囲む
- 値が分からない項目は空文字 "" や空配列 [] で埋める
- "complete": true / "account_mode": "fictional" / "name" を必ず含める
- JSONを途中で切らない

\`\`\`json
{
  "complete": true,
  "account_mode": "fictional",
  "name": "",
  "industry": "",
  "business_name": "",
  "business_description": "",
  "persona_role": "",
  "world_view": "",
  "voice_tone": "casual_polite",
  "target_audience": "",
  "must_include_elements": [],
  "good_examples": [],
  "ng_words": [],
  "hashtag_pool": [],
  "summary_message": ""
}
\`\`\``;

function finalizeInstruction(mode: AccountMode): string {
  return mode === "real"
    ? FINALIZE_INSTRUCTION_REAL
    : FINALIZE_INSTRUCTION_FICTIONAL;
}

function describeDbError(e: unknown): string {
  if (e && typeof e === "object") {
    const obj = e as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts: string[] = [];
    if (typeof obj.code === "string" && obj.code) parts.push(`[${obj.code}]`);
    if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
    if (typeof obj.details === "string" && obj.details) parts.push(obj.details);
    if (typeof obj.hint === "string" && obj.hint)
      parts.push(`hint: ${obj.hint}`);
    if (parts.length > 0) return parts.join(" ");
  }
  if (e instanceof Error) return e.message;
  return "詳細不明のエラー";
}

async function tryUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, any>,
): Promise<{ code: string | null; message: string } | null> {
  const { error } = await supabase
    .from("ai_hearing_sessions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("id", sessionId);
  if (!error) return null;
  return {
    code: (error as { code?: string }).code ?? null,
    message: describeDbError(error),
  };
}

async function saveFinalized(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  extracted: ExtractedHearingData,
  prompt: string,
): Promise<{ ok: true } | { ok: false; error: string; code: string | null }> {
  const e1 = await tryUpdate(supabase, sessionId, {
    extracted_data: extracted,
    generated_system_prompt: prompt,
    status: "completed",
    generated_at: new Date().toISOString(),
  });
  if (!e1) return { ok: true };
  console.error("[finalize] save attempt 1 (full) failed", e1);

  if (e1.code === "42703") {
    const e2 = await tryUpdate(supabase, sessionId, {
      extracted_data: extracted,
      generated_system_prompt: prompt,
      status: "completed",
    });
    if (!e2) return { ok: true };
    console.error("[finalize] save attempt 2 (no generated_at) failed", e2);

    if (e2.code === "42703") {
      const e3 = await tryUpdate(supabase, sessionId, {
        status: "completed",
      });
      if (!e3) return { ok: true };
      return { ok: false, error: e3.message, code: e3.code };
    }
    return { ok: false, error: e2.message, code: e2.code };
  }

  return { ok: false, error: e1.message, code: e1.code };
}

/**
 * 2026-05-23 T1: auto-persist the finalized hearing result as an
 * ai_configs row with status='draft' the moment finalize completes.
 *
 * Why: the previous flow required users to press the "保存" button on
 * the preview page; press-forgetting (or just navigating away)
 * silently lost ~10 minutes of hearing work. Auto-draft makes that
 * impossible — the preview page becomes a confirm/edit/activate
 * screen instead of a save-or-lose screen.
 *
 * Idempotent on session.ai_config_id:
 *   - first call → INSERT + link session.ai_config_id
 *   - subsequent calls (cached finalize, re-finalize) → UPDATE in
 *     place. If the user already pressed Activate (status='active'),
 *     we DO NOT downgrade back to 'draft', and we don't clobber any
 *     edits they made on the activated config from the AI設定詳細
 *     page — UPDATE only refreshes fields the AI re-extraction
 *     would have changed if they re-finalized.
 *
 * Failure here is logged but never blocks the finalize response —
 * the user can still see the prompt and manually activate. That
 * said, this should basically never fail because we already proved
 * the schema is writable when saveFinalized() succeeded above.
 */
async function ensureAiConfigDraft(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  sessionId: string;
  existingAiConfigId: string | null;
  extracted: ExtractedHearingData;
  prompt: string;
  sessionMode: AccountMode;
  industry: string | null;
}): Promise<{ aiConfigId: string | null }> {
  const {
    supabase,
    userId,
    sessionId,
    existingAiConfigId,
    extracted,
    prompt,
    sessionMode,
    industry,
  } = opts;

  const sharedFields = {
    account_mode: sessionMode,
    industry: extracted.industry ?? industry ?? null,
    business_name: extracted.business_name ?? null,
    business_description: extracted.business_description ?? null,
    persona_role: extracted.persona_role ?? null,
    world_view: extracted.world_view ?? null,
    voice_tone: extracted.voice_tone ?? null,
    target_audience: extracted.target_audience ?? null,
    ng_words: toStringArray(extracted.ng_words),
    must_include_elements: toStringArray(extracted.must_include_elements),
    good_examples: toStringArray(extracted.good_examples),
    hashtag_pool: toStringArray(extracted.hashtag_pool),
    generated_system_prompt: prompt,
    business_hours: extracted.business_hours ?? null,
    closed_days: extracted.closed_days ?? null,
    address: extracted.address ?? null,
    price_range: extracted.price_range ?? null,
    menu_items: toStringArray(extracted.menu_items),
    seasonal_items: toStringArray(extracted.seasonal_items),
    real_episodes: toStringArray(extracted.real_episodes),
    announcement_topics: toStringArray(extracted.announcement_topics),
  };

  // Existing row → UPDATE (refresh AI output, preserve activation + name).
  if (existingAiConfigId) {
    try {
      const existing = await getAiConfigById(supabase, existingAiConfigId);
      if (existing && existing.user_id === userId) {
        const patch: AiConfigUpdate = sharedFields;
        await updateAiConfig(supabase, existingAiConfigId, patch);
        return { aiConfigId: existingAiConfigId };
      }
      // Row not found (deleted by user / RLS-hidden) — fall through to
      // INSERT a fresh one. We'll re-link the session below.
      console.warn(
        "[finalize/draft] session.ai_config_id no longer resolves — re-creating",
        { sessionId, existingAiConfigId },
      );
    } catch (e) {
      console.warn("[finalize/draft] UPDATE path failed, will try INSERT", e);
    }
  }

  const insert: AiConfigInsert = applyAiConfigDefaults({
    user_id: userId,
    name: extracted.business_name?.trim() || "新しいAI設定",
    status: "draft",
    ...sharedFields,
  });
  try {
    const config = await createAiConfig(supabase, insert);
    // Link the session so subsequent finalize calls UPDATE this row
    // instead of inserting again.
    await supabase
      .from("ai_hearing_sessions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ ai_config_id: config.id } as any)
      .eq("id", sessionId);
    return { aiConfigId: config.id };
  } catch (e) {
    console.error("[finalize/draft] INSERT failed — preview will still work but no draft saved", e);
    return { aiConfigId: null };
  }
}

/**
 * Build the absolute-minimum extracted data so a stuck session can still
 * complete. Used when both the streaming endpoint and the re-prompt
 * extraction failed (e.g. session 797b5c6e-...).
 */
function buildSkeletonExtracted(
  mode: AccountMode,
  industry: string | null,
  messages: HearingMessage[],
): ExtractedHearingData {
  const industryLabel = industry ?? "";
  // First user message often contains the brand name; use as a hint.
  const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
  const guessName =
    firstUser.split(/[、。\n　 ]/)[0]?.slice(0, 24) || "";

  const skeleton: ExtractedHearingData = {
    complete: true,
    account_mode: mode,
    industry: industryLabel,
    business_name: guessName,
    business_description: "",
    persona_role: "",
    world_view: "",
    voice_tone: "casual_polite",
    target_audience: "",
    must_include_elements: [],
    good_examples: [],
    ng_words: [],
    hashtag_pool: [],
    summary_message:
      "ヒアリング内容から基本情報のみ抽出しました。プレビュー画面で内容を確認・編集してください。",
  };

  if (mode === "real") {
    return {
      ...skeleton,
      business_hours: "",
      closed_days: "",
      address: "",
      price_range: "",
      menu_items: [],
      seasonal_items: [],
      real_episodes: [],
      announcement_topics: [],
    };
  }
  return skeleton;
}

/**
 * Format conversation history for the re-extraction prompt.
 */
function formatConversation(messages: HearingMessage[]): string {
  return messages
    .map(
      (m) =>
        `[${m.role === "user" ? "ユーザー" : "インタビュアー"}] ${m.content}`,
    )
    .join("\n\n");
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { sessionId } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

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

  const sessionMode = normalizeAccountMode(session.account_mode);

  // Already finalized — return cached. Even on the cached path we run
  // ensureAiConfigDraft so sessions that were finalized BEFORE the
  // 2026-05-23 auto-draft fix get their ai_config backfilled the
  // first time the user revisits the preview page.
  if (session.extracted_data && session.generated_system_prompt) {
    const { aiConfigId } = await ensureAiConfigDraft({
      supabase,
      userId: user.id,
      sessionId,
      existingAiConfigId: session.ai_config_id ?? null,
      extracted: session.extracted_data,
      prompt: session.generated_system_prompt,
      sessionMode,
      industry: session.industry,
    });
    return NextResponse.json({
      extracted: session.extracted_data,
      prompt: session.generated_system_prompt,
      cached: true,
      ai_config_id: aiConfigId,
    });
  }

  const debugLog = {
    sessionId,
    accountMode: sessionMode,
    force,
    attempts: [] as string[],
    finalResult: "pending" as "success" | "fallback" | "skeleton" | "pending",
  };

  // ---- Attempt 1: extract from existing assistant messages -----------------
  for (const m of [...session.messages].reverse()) {
    if (m.role !== "assistant") continue;
    const tried = tryExtractFinalJson(m.content);
    debugLog.attempts.push("last_message");
    if (tried) {
      const normalized = normalizeExtractedData(tried, sessionMode);
      const prompt = buildSystemPromptForMode(normalized, sessionMode);
      const saveRes = await saveFinalized(supabase, sessionId, normalized, prompt);
      debugLog.finalResult = "success";
      console.log("[AI-HEARING-FINALIZE]", debugLog);
      if (!saveRes.ok && !force) {
        return NextResponse.json(
          {
            error: `保存に失敗しました: ${saveRes.error}`,
            extracted: normalized,
            prompt,
            debug: { code: saveRes.code },
          },
          { status: 500 },
        );
      }
      const { aiConfigId } = await ensureAiConfigDraft({
        supabase,
        userId: user.id,
        sessionId,
        existingAiConfigId: session.ai_config_id ?? null,
        extracted: normalized,
        prompt,
        sessionMode,
        industry: session.industry,
      });
      return NextResponse.json({
        extracted: normalized,
        prompt,
        source: "last_message",
        ai_config_id: aiConfigId,
      });
    }
  }

  // ---- Attempt 2: re-prompt Claude with strict JSON-only instructions -----
  const anthropic = getAnthropic();
  const apiMessages = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  apiMessages.push({
    role: "user",
    content: finalizeInstruction(sessionMode),
  });

  let regenerateText = "";
  try {
    const resp = await anthropic.messages.create({
      model: FINALIZE_MODEL,
      max_tokens: sessionMode === "real" ? 8192 : 4096,
      // Phase 7.5b: same interviewer prompt as /message — cache_control lets
      // this call hit the same 5-min cache when finalize follows shortly after
      // the last hearing turn. SDK 0.32 types lag the API.
      system: [
        {
          type: "text",
          text: interviewerPromptFor(sessionMode),
          cache_control: { type: "ephemeral" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      messages: apiMessages,
    });
    regenerateText = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = resp.usage as any;
    console.log("[anthropic][cache] hearing/finalize:regenerate", {
      sessionId,
      input: u?.input_tokens ?? 0,
      cache_create: u?.cache_creation_input_tokens ?? 0,
      cache_read: u?.cache_read_input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
    });
    debugLog.attempts.push("regenerate");
  } catch (e) {
    console.error("[hearing/finalize] regenerate failed", e);
    debugLog.attempts.push("regenerate_failed");
  }

  let extracted = regenerateText
    ? tryExtractFinalJson(regenerateText)
    : null;

  // ---- Attempt 3: a second extraction pass with a flat summarization
  //      prompt — sometimes interviewer system prompt confuses Claude --------
  if (!extracted) {
    debugLog.attempts.push("flat_extract");
    try {
      const flat = await anthropic.messages.create({
        model: FINALIZE_MODEL,
        max_tokens: sessionMode === "real" ? 8192 : 4096,
        system: `あなたは会話履歴から構造化データを抽出する専門家です。
以下の会話履歴を読み、${sessionMode === "real" ? "実在モード" : "架空モード"}用のJSONに整形して、\`\`\`json コードフェンスで囲んで出力してください。
取得できないフィールドは空文字列または空配列にしてください。
JSONのみ。前置き・後置きは1行以内。`,
        messages: [
          {
            role: "user",
            content: `会話履歴:\n\n${formatConversation(session.messages)}\n\n${finalizeInstruction(sessionMode)}`,
          },
        ],
      });
      const flatText = flat.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      extracted = tryExtractFinalJson(flatText);
    } catch (e) {
      console.error("[hearing/finalize] flat extract failed", e);
    }
  }

  // ---- Attempt 4: skeleton fallback (only if force=true) -------------------
  if (!extracted) {
    if (force) {
      debugLog.attempts.push("skeleton");
      extracted = buildSkeletonExtracted(
        sessionMode,
        session.industry,
        session.messages,
      );
      debugLog.finalResult = "skeleton";
    } else {
      debugLog.finalResult = "fallback";
      console.error("[AI-HEARING-FINALIZE]", {
        ...debugLog,
        rawPreview: regenerateText.slice(0, 500),
      });
      return NextResponse.json(
        {
          error:
            "構造化データの抽出に失敗しました。「強制完了」を試すか、もう少し会話を続けてからもう一度お試しください。",
          debug_preview: regenerateText.slice(0, 200),
          recovery_url: `/api/ai-hearing/${sessionId}/finalize?force=true`,
        },
        { status: 422 },
      );
    }
  } else {
    debugLog.finalResult = "success";
  }

  const normalized = normalizeExtractedData(extracted, sessionMode);
  const prompt = buildSystemPromptForMode(normalized, sessionMode);

  console.log("[AI-HEARING-FINALIZE]", {
    ...debugLog,
    extractedKeys: Object.keys(normalized),
  });

  const saveRes = await saveFinalized(supabase, sessionId, normalized, prompt);
  if (!saveRes.ok) {
    return NextResponse.json(
      {
        error: `保存に失敗しました: ${saveRes.error}`,
        extracted: normalized,
        prompt,
        debug: { code: saveRes.code },
      },
      { status: 500 },
    );
  }

  const { aiConfigId } = await ensureAiConfigDraft({
    supabase,
    userId: user.id,
    sessionId,
    existingAiConfigId: session.ai_config_id ?? null,
    extracted: normalized,
    prompt,
    sessionMode,
    industry: session.industry,
  });

  return NextResponse.json({
    extracted: normalized,
    prompt,
    source: debugLog.finalResult === "skeleton" ? "skeleton" : "regenerated",
    ai_config_id: aiConfigId,
  });
}
