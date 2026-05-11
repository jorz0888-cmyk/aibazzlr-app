"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function PublishConfirmDialog({
  open,
  username,
  platform,
  content,
  hashtags,
  onConfirm,
  onCancel,
  onAbort,
  loading,
}: {
  open: boolean;
  username: string;
  platform: string;
  content: string;
  hashtags: string[];
  onConfirm: () => void;
  onCancel: () => void;
  onAbort?: () => void;
  loading: boolean;
}) {
  const [abortPromptOpen, setAbortPromptOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (loading) {
        if (onAbort) setAbortPromptOpen(true);
      } else {
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onAbort, onCancel]);

  useEffect(() => {
    if (!open) setAbortPromptOpen(false);
  }, [open]);

  if (!open) return null;
  const tagText = hashtags.join(" ");
  const totalLen = (tagText ? content + "\n\n" + tagText : content).length;

  if (loading) {
    return (
      <>
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <div className="card flex flex-col items-center gap-4 px-8 py-10 text-center">
            <Spinner size={28} />
            <div>
              <div className="text-base font-bold text-ink">投稿中...</div>
              <div className="mt-1 text-xs text-ink-muted">
                X にツイートを送信しています
              </div>
              <div className="mt-2 text-[11px] text-ink-subtle">
                通信状況により数秒〜10秒ほどかかります
              </div>
              {onAbort && (
                <button
                  type="button"
                  onClick={() => setAbortPromptOpen(true)}
                  className="mt-4 text-[11px] text-ink-subtle underline underline-offset-2 transition hover:text-danger"
                >
                  Esc または ここをクリックで中断
                </button>
              )}
            </div>
          </div>
        </div>
        <ConfirmDialog
          open={abortPromptOpen}
          title="投稿を中断しますか？"
          description={
            <>
              X 側にはすでに投稿されている可能性があります。
              <br />
              中断後はポスト一覧でステータスをご確認ください。
            </>
          }
          confirmLabel="中断する"
          cancelLabel="続行"
          destructive
          onConfirm={() => {
            setAbortPromptOpen(false);
            onAbort?.();
          }}
          onCancel={() => setAbortPromptOpen(false)}
        />
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur sm:p-6"
      onClick={onCancel}
    >
      <div
        className="card flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden p-0 sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-line p-5 sm:p-6">
          <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
            ── CONFIRM PUBLISH
          </p>
          <h2 className="mt-1 text-lg font-bold text-ink">
            本当に投稿しますか？
          </h2>

          <div className="mt-4 space-y-1 rounded-lg border border-cyan/30 bg-cyan/5 p-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted">
              投稿先
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-cyan">@{username}</span>
              <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                {platform.toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="rounded-lg border border-line bg-bg/40 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-muted">
              内容（{totalLen}文字）
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {content}
            </p>
            {hashtags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hashtags.map((h) => (
                  <span
                    key={h}
                    className="rounded-full border border-cyan/30 bg-cyan/5 px-2 py-0.5 font-mono text-[10px] text-cyan"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="mt-4 text-[11px] text-ink-subtle">
            投稿後はXのタイムラインに即時反映されます。
          </p>
        </div>

        <footer className="shrink-0 border-t border-line bg-bg-surface/95 p-4 backdrop-blur sm:p-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={onCancel}
              disabled={loading}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn-primary w-full sm:w-auto"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? <Spinner /> : "🚀 投稿する"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
