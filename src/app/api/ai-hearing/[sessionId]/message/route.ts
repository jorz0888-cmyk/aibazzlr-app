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
import { normalizeExtractedData } from "@/lib/ai/normalize-extracted";
import {
  normalizeAccountMode,
  type HearingMessage,
} from "@/lib/supabase/types";
import { ensureAiConfigFromHearing } from "@/lib/db/ai-config-from-hearing";

export const runtime = "nodejs";
// Allow long-running streamed responses (Claude completion + DB write +
// optional finalize). Vercel Pro raises the cap to 300s.
export const maxDuration = 300;

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
        // Real mode emits a much larger JSON (extra fields: menu_items,
        // seasonal_items, real_episodes, announcement_topics, etc.) so we
        // need significantly more headroom on the final turn.
        const maxTokens = sessionMode === "real" ? 8192 : 4096;
        // Phase 7.5b: cache the long interviewer system prompt (>1024 tokens).
        // Same prompt is reused for every turn of a session — cache hits start
        // from turn 2 onward and cut input cost ~90% on the cached portion.
        // SDK 0.32 types lag the API; cache_control is supported at runtime.
        const aiStream = anthropic.messages.stream({
          model: HEARING_MODEL,
          max_tokens: maxTokens,
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

        let cacheCreate = 0;
        let cacheRead = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        for await (const event of aiStream) {
          if (event.type === "message_start") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const u = event.message.usage as any;
            inputTokens = u.input_tokens ?? 0;
            cacheCreate = u.cache_creation_input_tokens ?? 0;
            cacheRead = u.cache_read_input_tokens ?? 0;
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens ?? 0;
          } else if (
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
        console.log("[anthropic][cache] hearing/message", {
          sessionId,
          input: inputTokens,
          cache_create: cacheCreate,
          cache_read: cacheRead,
          output: outputTokens,
        });
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
          // Normalize: fill defaults, coerce arrays/strings, ensure mode tag.
          const normalized = normalizeExtractedData(extracted, sessionMode);
          const generatedPrompt = buildSystemPromptForMode(
            normalized,
            sessionMode,
          );
          // Try the full update; if a column doesn't exist (42703), fall
          // back to the minimal set so we at least flip the status.
          const fullPatch = {
            messages: [
              ...messagesWithUser,
              { ...assistantMsg, content: visibleText || fullText },
            ],
            extracted_data: normalized,
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
              extracted_data: normalized,
              generated_system_prompt: generatedPrompt,
              status: "completed" as const,
              current_step: TOTAL_HEARING_STEPS,
            });
          }

          // 2026-05-23 T1 BUGFIX: previously the auto-draft logic was
          // ONLY in /finalize, but this inline-completion path here in
          // /message is the actual common entry point — Claude streams
          // the final JSON on the last turn and we set status='completed'
          // right above. The client then sees `completed === true` and
          // redirects to the preview page WITHOUT POSTing /finalize, so
          // the previous fix was bypassed. Calling the shared helper
          // here closes that hole. Failure is logged, not thrown —
          // status flip already happened so the user gets to preview.
          try {
            const { aiConfigId } = await ensureAiConfigFromHearing({
              client: supabase,
              userId: user.id,
              sessionId,
              existingAiConfigId: session.ai_config_id ?? null,
              extracted: normalized,
              prompt: generatedPrompt,
              sessionMode,
              industry: session.industry,
            });
            console.log(
              "[hearing/message] auto-draft saved on inline completion",
              { sessionId, aiConfigId },
            );
          } catch (e) {
            console.error(
              "[hearing/message] auto-draft creation failed (preview backfill should rescue)",
              e,
            );
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
