import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { getAnthropic, FINALIZE_MODEL } from "@/lib/ai/anthropic";
import { HEARING_INTERVIEWER_PROMPT } from "@/lib/ai/hearing-prompts";
import {
  buildV14SystemPrompt,
  tryExtractFinalJson,
} from "@/lib/ai/v14-builder";
import type { ExtractedHearingData } from "@/lib/supabase/types";

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

/**
 * POST /api/ai-hearing/[sessionId]/finalize
 *
 * If the conversation didn't naturally end with the JSON block (e.g. user
 * cut it short, or the model emitted malformed JSON), re-prompt with strict
 * formatting rules. Returns the extracted data plus the v14 system prompt.
 */
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
  if (session.extracted_data && session.finalized_prompt) {
    return NextResponse.json({
      extracted: session.extracted_data,
      prompt: session.finalized_prompt,
      cached: true,
    });
  }

  // First, try to extract from the most recent assistant message in case the
  // streaming endpoint missed it.
  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastAssistant) {
    const extracted = tryExtractFinalJson(lastAssistant.content);
    if (extracted) {
      const prompt = buildV14SystemPrompt(extracted);
      try {
        await updateHearingSession(supabase, sessionId, {
          extracted_data: extracted,
          finalized_prompt: prompt,
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("[finalize] save (last-msg path) failed", e);
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
      system: HEARING_INTERVIEWER_PROMPT,
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

  const prompt = buildV14SystemPrompt(extracted);

  try {
    await updateHearingSession(supabase, sessionId, {
      extracted_data: extracted,
      finalized_prompt: prompt,
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[hearing/finalize] save failed", e);
    return NextResponse.json(
      { error: "保存に失敗しました（プロンプト生成は成功）" },
      { status: 500 },
    );
  }

  return NextResponse.json({ extracted, prompt, source: "regenerated" });
}
