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
import {
  normalizeAccountMode,
  type ExtractedHearingData,
} from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ sessionId: string }> };

const FINALIZE_INSTRUCTION = `ここまでの会話を踏まえて、システムプロンプト用の構造化データを必ず以下のフォーマットで出力してください。

【出力ルール（厳守）】
- 余計な前置き・後置きの文章は書かない
- 一番外側を \`\`\`json と \`\`\` で囲む
- 値が分からない項目は空文字 "" や空配列 [] で埋める
- 配列要素は最低3つ、できれば5つまで埋める
- "complete": true を必ず含める

\`\`\`json
{
  "complete": true,
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

/**
 * Save finalized result to ai_hearing_sessions. Tries the full payload first,
 * then progressively trims optional columns if Postgres complains they don't
 * exist. Returns null on success or an error description on failure.
 */
async function tryUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch: Record<string, any>,
): Promise<{ code: string | null; message: string } | null> {
  const { error } = await supabase
    .from("ai_hearing_sessions")
    // Cast: we manage column existence at runtime via 42703 fallback below.
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
  // Attempt 1: full payload
  const e1 = await tryUpdate(supabase, sessionId, {
    extracted_data: extracted,
    generated_system_prompt: prompt,
    status: "completed",
    generated_at: new Date().toISOString(),
  });
  if (!e1) return { ok: true };
  console.error("[finalize] save attempt 1 (full) failed", e1);

  // Attempt 2: drop generated_at if column doesn't exist
  if (e1.code === "42703") {
    const e2 = await tryUpdate(supabase, sessionId, {
      extracted_data: extracted,
      generated_system_prompt: prompt,
      status: "completed",
    });
    if (!e2) return { ok: true };
    console.error("[finalize] save attempt 2 (no generated_at) failed", e2);

    // Attempt 3: minimal (only status). At least the chat won't loop.
    if (e2.code === "42703") {
      const e3 = await tryUpdate(supabase, sessionId, {
        status: "completed",
      });
      if (!e3) return { ok: true };
      console.error("[finalize] save attempt 3 (status only) failed", e3);
      return { ok: false, error: e3.message, code: e3.code };
    }
    return { ok: false, error: e2.message, code: e2.code };
  }

  return { ok: false, error: e1.message, code: e1.code };
}

export async function POST(_request: NextRequest, { params }: Ctx) {
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

  // Already finalized — return cached.
  if (session.extracted_data && session.generated_system_prompt) {
    return NextResponse.json({
      extracted: session.extracted_data,
      prompt: session.generated_system_prompt,
      cached: true,
    });
  }

  const sessionMode = normalizeAccountMode(session.account_mode);

  // First, try to extract from the most recent assistant message in case the
  // streaming endpoint missed it.
  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastAssistant) {
    const extracted = tryExtractFinalJson(lastAssistant.content);
    if (extracted) {
      if (!extracted.account_mode) extracted.account_mode = sessionMode;
      const prompt = buildSystemPromptForMode(extracted, sessionMode);
      const saveRes = await saveFinalized(
        supabase,
        sessionId,
        extracted,
        prompt,
      );
      if (!saveRes.ok) {
        return NextResponse.json(
          {
            error: `保存に失敗しました: ${saveRes.error}`,
            extracted,
            prompt,
            debug: { code: saveRes.code },
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ extracted, prompt, source: "last_message" });
    }
  }

  // Re-ask the model with strict formatting instructions.
  const anthropic = getAnthropic();
  const apiMessages = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  apiMessages.push({
    role: "user",
    content: FINALIZE_INSTRUCTION,
  });

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: FINALIZE_MODEL,
      max_tokens: 4000,
      system: interviewerPromptFor(sessionMode),
      messages: apiMessages,
    });
  } catch (e) {
    console.error("[hearing/finalize] anthropic call failed", e);
    const msg = e instanceof Error ? e.message : "Anthropic API error";
    return NextResponse.json(
      { error: `AI呼び出しに失敗しました: ${msg}` },
      { status: 502 },
    );
  }

  const text = resp.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");

  const extracted: ExtractedHearingData | null = tryExtractFinalJson(text);
  if (!extracted) {
    console.error("[hearing/finalize] extraction failed", {
      preview: text.slice(0, 500),
    });
    return NextResponse.json(
      {
        error:
          "構造化データの抽出に失敗しました。「やり直す」を押すか、もう少し会話を続けてからもう一度お試しください。",
        debug_preview: text.slice(0, 200),
      },
      { status: 422 },
    );
  }

  if (!extracted.account_mode) extracted.account_mode = sessionMode;
  const prompt = buildSystemPromptForMode(extracted, sessionMode);

  const saveRes = await saveFinalized(supabase, sessionId, extracted, prompt);
  if (!saveRes.ok) {
    return NextResponse.json(
      {
        // Pass extracted+prompt so the client can still show preview even if
        // we couldn't persist it.
        error: `保存に失敗しました: ${saveRes.error}`,
        extracted,
        prompt,
        debug: { code: saveRes.code },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ extracted, prompt, source: "regenerated" });
}
