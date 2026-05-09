"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatBubble } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { ProgressBar } from "./ProgressBar";
import { Spinner } from "@/components/Spinner";
import type { AiHearingSession, HearingMessage } from "@/lib/supabase/types";

const TOTAL_STEPS = 10;

type FinalizingState = "idle" | "running" | "error";

export function HearingChat({ initial }: { initial: AiHearingSession }) {
  const router = useRouter();
  const [messages, setMessages] = useState<HearingMessage[]>(initial.messages);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(initial.current_step);
  const [completed, setCompleted] = useState(initial.status === "completed");
  const [finalizing, setFinalizing] = useState<FinalizingState>("idle");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const finalizeTriedRef = useRef(false);

  // Auto-scroll on each message / streaming token.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, thinking]);

  // If completed, redirect to preview.
  useEffect(() => {
    if (completed) {
      router.replace(
        `/dashboard/settings/ai/new/hearing/${initial.id}/preview`,
      );
    }
  }, [completed, initial.id, router]);

  async function refreshSessionState(): Promise<AiHearingSession | null> {
    try {
      const res = await fetch(`/api/ai-hearing/${initial.id}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const { session } = (await res.json()) as { session: AiHearingSession };
      return session;
    } catch {
      return null;
    }
  }

  async function autoFinalizeIfNeeded(s: AiHearingSession | null) {
    if (!s) return;
    if (s.status === "completed") {
      setCompleted(true);
      return;
    }
    // Reached the final step but extraction didn't happen — kick finalize.
    if (
      s.current_step >= TOTAL_STEPS &&
      !s.extracted_data &&
      !finalizeTriedRef.current
    ) {
      finalizeTriedRef.current = true;
      await runFinalize();
    }
  }

  async function runFinalize(opts: { force?: boolean } = {}) {
    setFinalizing("running");
    setFinalizeError(null);
    try {
      const url =
        `/api/ai-hearing/${initial.id}/finalize` +
        (opts.force ? "?force=true" : "");
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      setFinalizing("idle");
      setCompleted(true);
    } catch (e) {
      setFinalizing("error");
      setFinalizeError(
        e instanceof Error ? e.message : "完了処理に失敗しました",
      );
      // Allow manual retry on next button click.
      finalizeTriedRef.current = false;
    }
  }

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

      // Refetch session to detect completion / step / auto-finalize.
      const session = await refreshSessionState();
      if (session) {
        setCurrentStep(session.current_step);
      }
      await autoFinalizeIfNeeded(session);
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

  async function manualFinalize() {
    if (finalizing === "running") return;
    finalizeTriedRef.current = true;
    await runFinalize();
  }

  async function forceFinalize() {
    if (finalizing === "running") return;
    finalizeTriedRef.current = true;
    await runFinalize({ force: true });
  }

  const showFinalizeBanner =
    finalizing === "running" ||
    finalizing === "error" ||
    (currentStep >= TOTAL_STEPS && !completed);

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

        {showFinalizeBanner && (
          <FinalizeBanner
            state={finalizing}
            error={finalizeError}
            onRetry={manualFinalize}
            onForce={forceFinalize}
            sessionId={initial.id}
          />
        )}
      </div>

      {/* Input + actions */}
      <div className="space-y-2 border-t border-line pt-3">
        <ChatInput
          onSend={send}
          disabled={
            sending || completed || finalizing === "running"
          }
          placeholder={
            completed
              ? "ヒアリング完了。プレビューへ移動します..."
              : finalizing === "running"
                ? "完了処理中..."
                : undefined
          }
        />
        <div className="flex items-center justify-between text-[11px] text-ink-subtle">
          <span>Enterで送信 · Shift+Enterで改行</span>
          {currentStep >= 6 && !completed && finalizing !== "running" && (
            <button
              type="button"
              onClick={manualFinalize}
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

function FinalizeBanner({
  state,
  error,
  onRetry,
  onForce,
  sessionId,
}: {
  state: FinalizingState;
  error: string | null;
  onRetry: () => void;
  onForce: () => void;
  sessionId: string;
}) {
  if (state === "running") {
    return (
      <div className="space-y-2 rounded-xl border border-cyan/30 bg-cyan/5 p-4 text-sm text-ink">
        <div className="flex items-center gap-3">
          <Spinner size={16} />
          <span>
            会話の内容をAIが整理しています...（最大1分ほどかかります）
          </span>
        </div>
        <div className="pt-1 text-[11px] text-ink-subtle">
          長時間かかる場合は{" "}
          <a
            href={`/dashboard/settings/ai/new/hearing/${sessionId}/preview`}
            className="link-cyan"
          >
            プレビュー画面を直接開く
          </a>
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-ink">
        <div className="font-bold">完了処理に失敗しました</div>
        {error && <div className="text-xs text-ink-muted">{error}</div>}
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={onRetry} className="btn-primary">
            もう一度試す
          </button>
          <button type="button" onClick={onForce} className="btn-secondary">
            ⚡ 最低限の情報で完了する（強制）
          </button>
          <a
            href={`/dashboard/settings/ai/new/hearing/${sessionId}/preview`}
            className="btn-ghost"
          >
            プレビュー画面へ移動
          </a>
        </div>
        <p className="pt-1 text-[11px] text-ink-subtle">
          「強制完了」を押すと、ヒアリングで取れた情報だけでセッションを完了させ、プレビュー画面で編集できます。
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan/30 bg-cyan/5 p-4 text-sm text-ink">
      <span>10問のヒアリングが完了しました。次のステップへ進めます。</span>
      <button type="button" onClick={onRetry} className="btn-primary">
        プロンプトを生成して保存へ →
      </button>
    </div>
  );
}
