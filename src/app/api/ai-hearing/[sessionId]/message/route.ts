import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { getAnthropic, HEARING_MODEL } from "@/lib/ai/anthropic";
import {
  interviewerPromptFor,
  TOTAL_HEARING_STEPS,
} from "@/lib/ai/hearing-prompts";
import {
  buildSystemPromptForMode,
  stripJsonFence,
  tryExtractFinalJson,
} from "@/lib/ai/v14-builder";
import {
  normalizeAccountMode,
  type HearingMessage,
} from "@/lib/supabase/types";

export const runtime = "nodejs";
// Allow long-running streamed responses (Claude completion + DB write +
// optional finalize). Default Hobby cap is 10s; bump to 60s.
export const maxDuration = 60;

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
  try {
    await updateHearingSession(supabase, sessionId, {
      messages: messagesWithUser,
    });
  } catch (e) {
    console.error("[hearing/message] persist user msg failed", e);
    return NextResponse.json(
      { error: "メッセージの保存に失敗しました" },
      { status: 500 },
    );
  }

  // Stream the interviewer's reply.
  const anthropic = getAnthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      let streamCompleted = false;

      try {
        const apiMessages = messagesWithUser.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const sessionMode = normalizeAccountMode(session.account_mode);
        const aiStream = anthropic.messages.stream({
          model: HEARING_MODEL,
          max_tokens: 3000, // headroom for JSON output (~2k tokens)
          system: interviewerPromptFor(sessionMode),
          messages: apiMessages,
        });

        for await (const event of aiStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const piece = event.delta.text;
            fullText += piece;
            try {
              controller.enqueue(encoder.encode(piece));
            } catch {
              // client disconnected; keep going so we can still persist
            }
          }
        }
        streamCompleted = true;
      } catch (e) {
        console.error("[hearing/message] anthropic stream error", e);
        try {
          controller.enqueue(
            encoder.encode(
              "\n\n[エラーが発生しました。少し待ってから再試行してください]",
            ),
          );
        } catch {
          /* noop */
        }
      }

      // Always try to persist whatever was generated, even on partial failure.
      const assistantMsg: HearingMessage = {
        role: "assistant",
        content: fullText || "(応答が生成されませんでした)",
        created_at: new Date().toISOString(),
      };

      try {
        const extracted = tryExtractFinalJson(fullText);
        const visibleText = stripJsonFence(fullText);

        if (extracted) {
          const sessionMode = normalizeAccountMode(session.account_mode);
          // Make sure the extracted data carries the correct mode tag so
          // downstream save/reload knows which template was used.
          if (!extracted.account_mode) extracted.account_mode = sessionMode;
          const generatedPrompt = buildSystemPromptForMode(
            extracted,
            sessionMode,
          );
          // Try the full update; if a column doesn't exist (42703), fall
          // back to the minimal set so we at least flip the status.
          const fullPatch = {
            messages: [
              ...messagesWithUser,
              { ...assistantMsg, content: visibleText || fullText },
            ],
            extracted_data: extracted,
            generated_system_prompt: generatedPrompt,
            status: "completed" as const,
            generated_at: new Date().toISOString(),
            current_step: TOTAL_HEARING_STEPS,
          };
          try {
            await updateHearingSession(supabase, sessionId, fullPatch);
          } catch (firstErr) {
            const code = (firstErr as { code?: string })?.code;
            console.warn(
              "[hearing/message] full patch failed; retrying minimal",
              { code, firstErr },
            );
            await updateHearingSession(supabase, sessionId, {
              messages: [
                ...messagesWithUser,
                { ...assistantMsg, content: visibleText || fullText },
              ],
              extracted_data: extracted,
              generated_system_prompt: generatedPrompt,
              status: "completed" as const,
              current_step: TOTAL_HEARING_STEPS,
            });
          }
        } else {
          await updateHearingSession(supabase, sessionId, {
            messages: [...messagesWithUser, assistantMsg],
            current_step: Math.min(
              session.current_step + 1,
              TOTAL_HEARING_STEPS,
            ),
          });
        }
      } catch (e) {
        console.error("[hearing/message] post-stream save failed", e);
        // Best effort: try to at least record the assistant message.
        try {
          await updateHearingSession(supabase, sessionId, {
            messages: [...messagesWithUser, assistantMsg],
          });
        } catch {
          /* give up */
        }
      }

      try {
        if (!streamCompleted) {
          controller.enqueue(encoder.encode(""));
        }
        controller.close();
      } catch {
        /* already closed */
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
