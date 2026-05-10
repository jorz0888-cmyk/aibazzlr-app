"use client";

import { Spinner } from "@/components/Spinner";

export function PublishConfirmDialog({
  open,
  username,
  platform,
  content,
  hashtags,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  username: string;
  platform: string;
  content: string;
  hashtags: string[];
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  const tagText = hashtags.join(" ");
  const totalLen = (tagText ? content + "\n\n" + tagText : content).length;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur sm:p-6"
      onClick={loading ? undefined : onCancel}
    >
      {/*
        3-row grid: header (固定) / body (内側スクロール) / footer (固定).
        max-h-[90vh] (95vh on mobile) ensures buttons stay on-screen even
        for full 280-char drafts without zooming the browser.
      */}
      <div
        className="card flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden p-0 sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky */}
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

        {/* Body — scrolls when content overflows */}
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

        {/* Footer — sticky */}
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
