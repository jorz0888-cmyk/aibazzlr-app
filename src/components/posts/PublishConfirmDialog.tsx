"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { weightedRenderedTweet } from "@/lib/posts/x-text";

export type PublishMethod = "api" | "copy_paste";

function buildXIntent(text: string): string {
  // x.com/intent/post is the documented share-intent URL; supports prefilled
  // text reliably on both logged-in and signed-out flows. compose/post does
  // not — some clients drop the text param.
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function PublishConfirmDialog({
  open,
  postId,
  username,
  platform,
  content,
  hashtags,
  imageUrl,
  onConfirm,
  onCancel,
  onAbort,
  onCopyPasteDone,
  loading,
  publishError,
  defaultMethod = "api",
  maxPostLength,
}: {
  open: boolean;
  /** Used for the copy-paste sub-flow APIs (mark-as-awaiting-manual / mark-as-posted). */
  postId: string;
  username: string;
  platform: string;
  content: string;
  hashtags: string[];
  /** Optional image attached to the draft (Phase 12). */
  imageUrl?: string | null;
  /** Called when the user picks "X に直接投稿" and confirms. */
  onConfirm: () => void;
  onCancel: () => void;
  onAbort?: () => void;
  /** Called after the user clicks "投稿しました" in copy-paste mode. */
  onCopyPasteDone?: () => void;
  loading: boolean;
  /** Last error from the API publish path. Used to surface the copy-paste fallback. */
  publishError?: string | null;
  /** Pre-select the radio: derive from AI config's posting_mode upstream. */
  defaultMethod?: PublishMethod;
  /**
   * 2026-05-24 #D-followup: per-config X-weighted ceiling. Falls back
   * to 280 (the X non-Premium hard limit) if the caller doesn't have
   * the config to hand, so we never under-report cap. The counter
   * and over-cap badge are computed from this PLUS the same
   * weightedRenderedTweet() the publisher uses — replaces the old
   * `tweetText.length` + hardcoded 280 path that under-counted JP
   * by half and let 558-count drafts through as "OK".
   */
  maxPostLength?: number;
}) {
  const [abortPromptOpen, setAbortPromptOpen] = useState(false);
  const [method, setMethod] = useState<PublishMethod>(defaultMethod);
  // Sub-modes for the copy-paste branch.
  const [mode, setMode] = useState<"choose" | "copy_paste_actions">("choose");
  const [transitioning, setTransitioning] = useState(false);
  const [innerError, setInnerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset internal state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setMethod(defaultMethod);
      setMode("choose");
      setTransitioning(false);
      setInnerError(null);
      setCopied(false);
    }
  }, [open, defaultMethod]);

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
  const tweetText = tagText ? `${content}\n\n${tagText}` : content;
  // 2026-05-24 #D-followup: switched from tweetText.length (raw JS
  // chars — under-counts JP by 2×) to the X-weighted counter the
  // publisher / generator already use. Per-config cap replaces the
  // hardcoded 280. JP-char approximation is shown alongside the raw
  // count for clarity (same scheme as PostCard).
  const totalLen = weightedRenderedTweet(content, hashtags);
  const cap = maxPostLength ?? 280;
  const over = totalLen > cap;
  const totalLenJp = Math.round(totalLen / 2);
  const capJp = Math.round(cap / 2);

  // ─── Sending state (only used when method === 'api') ──────────────────
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

  // ─── Copy-paste actions sub-mode ──────────────────────────────────────
  if (mode === "copy_paste_actions") {
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
              ── COPY &amp; POST
            </p>
            <h2 className="mt-1 text-lg font-bold text-ink">
              コピペで投稿
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              本文をコピーして X で貼り付け → 戻って「投稿しました」を押してください
            </p>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 sm:p-6">
            {imageUrl && (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="投稿画像"
                    className="h-auto max-h-48 w-full object-cover"
                  />
                </div>
                <a
                  href={imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex items-center text-xs"
                >
                  📥 画像をダウンロード
                </a>
                <p className="rounded-md bg-warning/10 p-2 text-[11px] leading-relaxed text-warning">
                  📸 X の投稿画面では <b>画像が自動添付されません</b>。
                  上のボタンで画像をダウンロード →
                  X 投稿画面の「画像を追加」から手動でアップロードしてください。
                </p>
              </div>
            )}
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg/40 p-4 font-sans text-sm leading-relaxed text-ink">
              {tweetText}
            </pre>
            <p
              className={[
                "text-[11px]",
                over ? "text-danger" : "text-ink-subtle",
              ].join(" ")}
            >
              約{totalLenJp}字 / {capJp}字（X基準・{totalLen}/{cap}カウント）
              {over && (
                <span className="ml-2 font-bold">
                  ⚠ X の上限を超過しています
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  setInnerError(null);
                  try {
                    await navigator.clipboard.writeText(tweetText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch (e) {
                    setInnerError(
                      e instanceof Error ? e.message : "コピーに失敗しました",
                    );
                  }
                }}
              >
                {copied ? "コピー済み ✓" : "📋 本文をコピー"}
              </button>
              <a
                href={buildXIntent(tweetText)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                🔗 X で開く
              </a>
            </div>
            {innerError && (
              <p className="text-xs text-danger">{innerError}</p>
            )}
            <p className="rounded-md bg-white/5 p-3 text-[11px] leading-relaxed text-ink-subtle">
              「X で開く」は X.com の投稿画面を新しいタブで開き、本文を自動で貼り付けます。
              送信後にこのダイアログへ戻り「投稿しました」を押すと、AIBazzlr 側でも記録されます。
            </p>
          </div>

          <footer className="shrink-0 border-t border-line bg-bg-surface/95 p-4 backdrop-blur sm:p-5">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={onCancel}
              >
                閉じる
              </button>
              <button
                type="button"
                className="btn-primary w-full sm:w-auto"
                onClick={async () => {
                  setInnerError(null);
                  setTransitioning(true);
                  try {
                    const res = await fetch(
                      `/api/posts/${postId}/mark-as-posted`,
                      { method: "POST" },
                    );
                    if (!res.ok) {
                      const body = (await res
                        .json()
                        .catch(() => ({}))) as { error?: string };
                      throw new Error(body.error ?? `HTTP ${res.status}`);
                    }
                    onCopyPasteDone?.();
                  } catch (e) {
                    setInnerError(
                      e instanceof Error ? e.message : "更新に失敗しました",
                    );
                    setTransitioning(false);
                  }
                }}
                disabled={transitioning}
              >
                {transitioning ? <Spinner /> : "✅ 投稿しました"}
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // ─── Choice mode (initial) ───────────────────────────────────────────
  async function startCopyPaste() {
    setInnerError(null);
    setTransitioning(true);
    try {
      const res = await fetch(
        `/api/posts/${postId}/mark-as-awaiting-manual`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMode("copy_paste_actions");
    } catch (e) {
      setInnerError(e instanceof Error ? e.message : "切り替えに失敗しました");
    } finally {
      setTransitioning(false);
    }
  }

  const isForbidden =
    !!publishError &&
    /403|forbidden|スパム|権限|許可|denied/i.test(publishError);

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
            投稿しますか？
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

        {/* Scrollable preview only — keeps method radio + footer in view. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {imageUrl && (
            <div className="mb-3 overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="投稿画像"
                className="h-auto max-h-48 w-full object-cover"
              />
            </div>
          )}
          <div className="rounded-lg border border-line bg-bg/40 p-4">
            <div
              className={[
                "mb-2 text-[11px] uppercase tracking-wider",
                over ? "text-danger" : "text-ink-muted",
              ].join(" ")}
            >
              内容（約{totalLenJp}字 / {capJp}字・X基準）
              {over && <span className="ml-2">⚠ 上限超過</span>}
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

        </div>

        {/* Method radio is shrink-0 so it never scrolls out of view, even
            for long post bodies. Sits between body and footer. */}
        <div className="shrink-0 space-y-3 border-t border-line bg-bg-surface/95 p-5 backdrop-blur sm:p-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            投稿方法を選択
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <MethodRadio
              value="api"
              current={method}
              onChange={setMethod}
              label="X に直接投稿"
              description="AI が自動で X に投稿（API 経由）"
            />
            <MethodRadio
              value="copy_paste"
              current={method}
              onChange={setMethod}
              label="コピペで投稿"
              badge="新規 X 推奨"
              description="本文をコピーして自分で X に投稿（API 不使用）"
            />
          </div>

          {publishError && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <p className="font-bold">前回の投稿でエラーが発生しました</p>
              <p className="mt-1 whitespace-pre-wrap">{publishError}</p>
              {isForbidden && (
                <p className="mt-2 text-[11px]">
                  X 側のスパム対策により API 投稿がブロックされている可能性があります。
                  上の「コピペで投稿」に切り替えてお試しください。
                </p>
              )}
            </div>
          )}

          {innerError && (
            <p className="text-xs text-danger">{innerError}</p>
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-bg-surface/95 p-4 backdrop-blur sm:p-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={onCancel}
              disabled={transitioning}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn-primary w-full sm:w-auto"
              onClick={() => {
                if (method === "api") {
                  onConfirm();
                } else {
                  void startCopyPaste();
                }
              }}
              disabled={transitioning}
            >
              {transitioning ? (
                <Spinner />
              ) : method === "api" ? (
                "🚀 X に投稿する"
              ) : (
                "📋 コピペ画面へ"
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function MethodRadio({
  value,
  current,
  onChange,
  label,
  description,
  badge,
}: {
  value: PublishMethod;
  current: PublishMethod;
  onChange: (v: PublishMethod) => void;
  label: string;
  description: string;
  badge?: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={[
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-left text-sm transition",
        active
          ? "border-cyan bg-cyan/10 text-ink"
          : "border-line text-ink-muted hover:border-cyan/40",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-2 font-bold">
        <span className="flex items-center gap-2">
          <span
            className={[
              "grid h-4 w-4 place-items-center rounded-full border",
              active ? "border-cyan" : "border-line-strong",
            ].join(" ")}
          >
            {active && <span className="h-2 w-2 rounded-full bg-cyan" />}
          </span>
          {label}
        </span>
        {badge && (
          <span className="rounded-full bg-cyan/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-cyan">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[11px] text-ink-subtle">{description}</span>
    </button>
  );
}
