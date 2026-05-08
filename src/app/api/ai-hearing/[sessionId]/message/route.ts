import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { getAnthropic, HEARING_MODEL } from "@/lib/ai/anthropic";
import {
  HEARING_INTERVIEWER_PROMPT,
  TOTAL_HEARING_STEPS,
} from "@/lib/ai/hearing-prompts";
import {
  buildV14SystemPrompt,
  stripJsonFence,
  tryExtractFinalJson,
} from "@/lib/ai/v14-builder";
import type { HearingMessage } from "@/lib/supabase/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ sessionId: string }> };

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
  if (session.status !== "in_progress") {
    return NextResponse.json(
      { error: "Session is not in progress" },
      { status: 409 },
    );
  }

  const body = (await request.json()) as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  // Persist the user message immediately so refresh-mid-stream still recovers state.
  const userMsg: HearingMessage = {
    role: "user",
    content,
    created_at: new Date().toISOString(),
  };
  const messagesWithUser = [...session.messages, userMsg];
  await updateHearingSession(supabase, sessionId, {
    messages: messagesWithUser,
  });

  // Stream the interviewer's reply.
  const anthropic = getAnthropic();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      try {
        const apiMessages = messagesWithUser.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const aiStream = anthropic.messages.stream({
          model: HEARING_MODEL,
          max_tokens: 1500,
          system: HEARING_INTERVIEWER_PROMPT,
          messages: apiMessages,
        });

        for await (const event of aiStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const piece = event.delta.text;
            fullText += piece;
            controller.enqueue(encoder.encode(piece));
          }
        }

        // Persist the assistant message + maybe finalize.
        const assistantMsg: HearingMessage = {
          role: "assistant",
          content: fullText,
          created_at: new Date().toISOString(),
        };
        const finalMessages = [...messagesWithUser, assistantMsg];

        const extracted = tryExtractFinalJson(fullText);
        const visibleText = stripJsonFence(fullText);

        if (extracted) {
          const finalizedPrompt = buildV14SystemPrompt(extracted);
          await updateHearingSession(supabase, sessionId, {
            messages: [
              ...messagesWithUser,
              { ...assistantMsg, content: visibleText || fullText },
            ],
            extracted_data: extracted,
            finalized_prompt: finalizedPrompt,
            status: "completed",
            completed_at: new Date().toISOString(),
            current_step: TOTAL_HEARING_STEPS,
          });
        } else {
          await updateHearingSession(supabase, sessionId, {
            messages: finalMessages,
            current_step: Math.min(
              session.current_step + 1,
              TOTAL_HEARING_STEPS,
            ),
          });
        }

        controller.close();
      } catch (e) {
        console.error("[hearing/message] stream error", e);
        try {
          controller.enqueue(
            encoder.encode(
              "\n\n[エラーが発生しました。少し待ってから再試行してください]",
            ),
          );
        } catch {
          /* noop */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
