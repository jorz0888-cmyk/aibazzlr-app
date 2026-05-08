"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatBubble } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ProgressBar } from "./ProgressBar";
import type { AiHearingSession, HearingMessage } from "@/lib/supabase/types";

const TOTAL_STEPS = 10;

export function HearingChat({ initial }: { initial: AiHearingSession }) {
  const router = useRouter();
  const [messages, setMessages] = useState<HearingMessage[]>(initial.messages);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(initial.current_step);
  const [completed, setCompleted] = useState(initial.status === "completed");
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on each message / streaming token.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, thinking]);

  // If initial session is already completed (e.g. resume), bounce to preview.
  useEffect(() => {
    if (completed) {
      router.replace(
        `/dashboard/settings/ai/new/hearing/${initial.id}/preview`,
      );
    }
  }, [completed, initial.id, router]);

  async function send(text: string) {
    if (sending || completed) return;
    setError(null);

    const optimistic: HearingMessage = {
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    setThinking(true);
    setStreamingText("");

    try {
      const res = await fetch(
        `/api/ai-hearing/${initial.id}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        },
      );

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (firstChunk) {
          setThinking(false);
          firstChunk = false;
        }
        acc += chunk;
        setStreamingText(acc);
      }

      // Strip JSON fence from displayed assistant text.
      const visible = acc.replace(/```json\s*[\s\S]*?```/i, "").trim();
      const finalText = visible || acc;

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: finalText,
          created_at: new Date().toISOString(),
        },
      ]);
      setStreamingText(null);

      // Refetch session to detect completion / step.
      const stateRes = await fetch(`/api/ai-hearing/${initial.id}`, {
        cache: "no-store",
      });
      if (stateRes.ok) {
        const { session } = (await stateRes.json()) as {
          session: AiHearingSession;
        };
        setCurrentStep(session.current_step);
        if (session.status === "completed") setCompleted(true);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "送信に失敗しました。再試行してください。",
      );
      setStreamingText(null);
    } finally {
      setThinking(false);
      setSending(false);
    }
  }

  async function finalizeManually() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai-hearing/${initial.id}/finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setCompleted(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "終了処理に失敗しました。もう少し会話を続けてみてください。",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[520px] flex-col">
      {/* Sticky progress */}
      <div className="sticky top-0 z-10 -mx-2 mb-3 rounded-xl border border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <ProgressBar current={currentStep} total={TOTAL_STEPS} />
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 space-y-4 overflow-y-auto px-1 pb-4"
      >
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role}>
            {m.content}
          </ChatBubble>
        ))}

        {streamingText !== null && streamingText.length > 0 && (
          <ChatBubble role="assistant" streaming>
            {streamingText.replace(/```json\s*[\s\S]*?```/i, "").trim() ||
              streamingText}
          </ChatBubble>
        )}

        {thinking && <TypingIndicator />}

        {error && (
          <div className="err">
            {error}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setError(null)}
            >
              閉じる
            </button>
          </div>
        )}
      </div>

      {/* Input + actions */}
      <div className="space-y-2 border-t border-line pt-3">
        <ChatInput
          onSend={send}
          disabled={sending || completed}
          placeholder={
            completed ? "ヒアリング完了。プレビューへ移動します..." : undefined
          }
        />
        <div className="flex items-center justify-between text-[11px] text-ink-subtle">
          <span>Enterで送信 · Shift+Enterで改行</span>
          {currentStep >= 6 && !completed && (
            <button
              type="button"
              onClick={finalizeManually}
              disabled={sending}
              className="text-ink-muted underline-offset-2 hover:text-cyan hover:underline disabled:opacity-50"
            >
              ここで終わりにする →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
