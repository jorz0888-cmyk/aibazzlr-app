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

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/ai-hearing/[sessionId]/finalize
 *
 * If the conversation didn't naturally end with the JSON block (e.g. user
 * cut it short), we re-prompt the model to summarise what's been gathered
 * and return the structured JSON. Returns the extracted data plus the
 * generated v14 system prompt.
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
    });
  }

  // Re-ask the model to emit the JSON block based on the conversation so far.
  const anthropic = getAnthropic();
  const apiMessages = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  apiMessages.push({
    role: "user",
    content:
      "ここまでの会話を踏まえて、システムプロンプト用の構造化データを ```json コードフェンスで囲んで出力してください。会話文は不要です。",
  });

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: FINALIZE_MODEL,
      max_tokens: 1500,
      system: HEARING_INTERVIEWER_PROMPT,
      messages: apiMessages,
    });
  } catch (e) {
    console.error("[hearing/finalize]", e);
    return NextResponse.json(
      { error: "Anthropic API failed" },
      { status: 502 },
    );
  }

  const text = resp.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");

  const extracted: ExtractedHearingData | null = tryExtractFinalJson(text);
  if (!extracted) {
    return NextResponse.json(
      {
        error:
          "構造化データの抽出に失敗しました。会話を続けてからもう一度お試しください。",
      },
      { status: 422 },
    );
  }

  const prompt = buildV14SystemPrompt(extracted);

  await updateHearingSession(supabase, sessionId, {
    extracted_data: extracted,
    finalized_prompt: prompt,
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  return NextResponse.json({ extracted, prompt });
}
