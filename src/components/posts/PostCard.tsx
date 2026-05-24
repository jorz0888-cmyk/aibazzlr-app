"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PostEditorModal } from "./PostEditorModal";
import { PublishConfirmDialog } from "./PublishConfirmDialog";
import type { PostListItem } from "./types";
import { friendlyErrorMessage } from "@/lib/errors/client";
import { weightedRenderedTweet } from "@/lib/posts/x-text";

// stuck = publishing status held for more than this. The pg_cron cleanup job
// runs at the same threshold (5 min), so this UI warning means
// "the auto-recovery should kick in within the next minute or two".
const PUBLISHING_STUCK_THRESHOLD_MS = 5 * 60 * 1000;

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

export function PostCard({ post }: { post: PostListItem }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<null | "publish" | "delete" | "retry">(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const username = post.social_account?.username ?? "(unknown)";
  const platform = post.social_account?.platform ?? "x";
  const aiName = post.ai_config?.name ?? "(AI設定なし)";
  const aiMode = post.ai_config?.account_mode === "fictional" ? "🎭" : "🏪";

  const deleteLabel =
    post.status === "failed"
      ? "この失敗投稿を削除しますか？"
      : post.status === "cancelled"
        ? "このキャンセル済み投稿を削除しますか？"
        : "このドラフトを削除しますか？";

  const isStuckPublishing =
    post.status === "publishing" &&
    Date.now() - new Date(post.updated_at).getTime() >
      PUBLISHING_STUCK_THRESHOLD_MS;

  async function publish() {
    setBusy("publish");
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        warning?: string;
        url?: string;
        tweet_id?: string;
      };
      if (!res.ok) throw new Error(friendlyErrorMessage(body));

      setConfirming(false);
      toast.success("投稿が完了しました", {
        description: (
          <>
            <span>
              <span className="font-bold text-cyan">@{username}</span>{" "}
              のタイムラインに送信されました。
            </span>
            {body.warning && (
              <div className="mt-1 text-yellow-400">⚠ {body.warning}</div>
            )}
          </>
        ),
        action: body.url
          ? { label: "X で投稿を見る", href: body.url }
          : undefined,
      });
      router.refresh();
    } catch (e) {
      // Distinguish user-initiated abort from genuine failure.
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        setConfirming(false);
        toast.info("投稿処理を中断しました", {
          description:
            "X 側に送信されている可能性があります。一覧で状態を確認してください。",
        });
        router.refresh();
      } else {
        const msg = e instanceof Error ? e.message : "投稿に失敗しました";
        setError(msg);
        toast.error("投稿に失敗しました", { description: msg });
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  function abortPublish() {
    abortRef.current?.abort();
  }

  async function retry() {
    setBusy("retry");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/retry`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        warning?: string;
      };
      if (!res.ok) throw new Error(friendlyErrorMessage(body));
      toast.success("再投稿に成功しました", {
        description: `@${username} に送信されました`,
        action: body.url
          ? { label: "X で投稿を見る", href: body.url }
          : undefined,
      });
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "再試行に失敗しました";
      setError(msg);
      toast.error("再試行に失敗しました", { description: msg });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(friendlyErrorMessage(body));
      }
      setDeleteOpen(false);
      toast.info("投稿を削除しました");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "削除に失敗しました";
      setError(msg);
      toast.error("削除に失敗しました", { description: msg });
      setBusy(null);
    }
  }

  const tone = (() => {
    switch (post.status) {
      case "posted":
      case "published":
        return {
          border: "border-success/30",
          bg: "bg-success/5",
          label: "投稿済",
          color: "text-success",
        };
      case "failed":
        return {
          border: "border-danger/30",
          bg: "bg-danger/5",
          label: "失敗",
          color: "text-danger",
        };
      case "publishing":
        return {
          border: "border-cyan/30",
          bg: "bg-cyan/5",
          label: "処理中",
          color: "text-cyan",
        };
      default:
        return {
          border: "border-line",
          bg: "bg-bg-surface/40",
          label: post.status === "draft" ? "ドラフト" : post.status,
          color: "text-ink-muted",
        };
    }
  })();

  return (
    <>
      <article
        className={`card space-y-3 p-5 ${tone.border} ${tone.bg} transition`}
      >
        <header className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border ${tone.border} bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-widest ${tone.color}`}
          >
            {tone.label.toUpperCase()}
          </span>
          <span className="text-xs text-ink-muted">
            {relTime(post.created_at)}
          </span>
          <span className="text-ink-subtle">·</span>
          <span className="text-xs text-ink">
            {aiMode} {aiName}
          </span>
          <span className="text-ink-subtle">·</span>
          <span className="text-xs text-cyan">@{username}</span>
          {isStuckPublishing && (
            <span
              title="処理が停止している可能性があります。数分待つと自動回収されます。"
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-yellow-300"
            >
              ⚠️ STUCK
            </span>
          )}
        </header>

        {post.image_url && (
          <a
            href={post.image_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border border-line"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image_url}
              alt="投稿画像"
              className="h-auto max-h-64 w-full object-cover"
            />
          </a>
        )}

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {post.content}
        </p>

        {post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.hashtags.map((h) => (
              <span
                key={h}
                className="rounded-full border border-cyan/30 bg-cyan/5 px-2 py-0.5 font-mono text-[10px] text-cyan"
              >
                {h}
              </span>
            ))}
          </div>
        )}

        {(() => {
          // 2026-05-22: use the X-weighted counter the publisher actually
          // gates on, not raw JS string length. JP content scored ~2× low
          // before this fix and the badge would say "OK" while the publish
          // would 403 for length.
          //
          // 2026-05-24 #D: display in JP-char approximation (count / 2)
          // because the previous "{count} 文字" suffix made users read the
          // raw X-weighted count as "Japanese characters". For JP-centric
          // content len/2 ≈ actual JP char count; for ASCII-heavy content
          // it under-estimates by half but the "約" prefix and "(X基準)"
          // suffix acknowledge that. Calculation logic itself is
          // unchanged — over/warn still use the raw weighted count.
          const len = weightedRenderedTweet(
            post.content,
            post.hashtags ?? [],
          );
          const max = post.ai_config?.max_post_length ?? 140;
          const over = len > max;
          const warn = !over && len >= Math.floor(max * 0.9);
          const lenJpApprox = Math.round(len / 2);
          const maxJpApprox = Math.round(max / 2);
          return (
            <p
              className={[
                "font-mono text-[11px]",
                over
                  ? "text-danger"
                  : warn
                    ? "text-warning"
                    : "text-ink-subtle",
              ].join(" ")}
            >
              ✏ 約{lenJpApprox}字 / {maxJpApprox}字（X基準）
              {over && (
                <span className="ml-2 font-sans">
                  ⚠ 上限超過 — 投稿時に末尾を切り詰めます
                </span>
              )}
            </p>
          );
        })()}

        {post.strategic_intent && (
          <p className="flex items-start gap-1.5 rounded-md border border-line bg-white/5 p-2 text-[11px] leading-relaxed text-ink-muted">
            <span aria-hidden>💡</span>
            <span>{post.strategic_intent}</span>
          </p>
        )}

        {post.status === "publishing" && (
          <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-3 text-xs text-cyan">
            <span className="inline-flex items-center gap-2">
              <Spinner size={14} />
              <span>
                X に送信中、または処理待機中です（最終更新:{" "}
                {relTime(post.updated_at)}）
              </span>
            </span>
            {isStuckPublishing && (
              <div className="mt-1 text-yellow-300">
                5 分以上停滞しています。自動回収ジョブが数分以内にこの投稿を
                <code className="mx-1">posted</code> または
                <code className="mx-1">failed</code> に倒します。
              </div>
            )}
          </div>
        )}

        {post.error_message && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            ⚠️ {post.error_message}
            {post.retry_count > 0 && (
              <span className="ml-2 text-[11px] text-ink-subtle">
                (試行 {post.retry_count}回)
              </span>
            )}
          </div>
        )}

        {post.platform_post_url && (
          <div>
            <a
              href={post.platform_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="link-cyan text-xs"
            >
              🔗 投稿を見る → {post.platform_post_url}
            </a>
            {post.posted_at && (
              <span className="ml-3 text-[11px] text-ink-subtle">
                投稿: {relTime(post.posted_at)}
              </span>
            )}
          </div>
        )}

        {error && <div className="text-xs text-danger">{error}</div>}

        <footer className="flex flex-wrap gap-2 pt-1">
          {post.status === "draft" && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(true)}
                disabled={busy !== null}
              >
                編集
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setConfirming(true)}
                disabled={busy !== null}
              >
                🚀 投稿する
              </button>
              <button
                type="button"
                className="btn-secondary border-danger/30 text-danger hover:bg-danger/10"
                onClick={() => setDeleteOpen(true)}
                disabled={busy !== null}
              >
                {busy === "delete" ? <Spinner size={14} /> : "削除"}
              </button>
            </>
          )}
          {post.status === "failed" && (
            <>
              {!post.platform_post_id && (post.retry_count ?? 0) < 3 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={retry}
                  disabled={busy !== null}
                >
                  {busy === "retry" ? <Spinner /> : "再試行"}
                </button>
              )}
              {(post.retry_count ?? 0) >= 3 && !post.platform_post_id && (
                <span className="text-[11px] text-ink-subtle">
                  再試行回数の上限です。編集してから新規生成してください。
                </span>
              )}
              <button
                type="button"
                className="btn-secondary border-danger/30 text-danger hover:bg-danger/10"
                onClick={() => setDeleteOpen(true)}
                disabled={busy !== null}
              >
                {busy === "delete" ? <Spinner size={14} /> : "削除"}
              </button>
            </>
          )}
        </footer>
      </article>

      {/* Phase 7.5c: render only while open so every open is a fresh mount.
          PostEditorModal's inner `if (!open) return null` does NOT unmount —
          internal state (saving=true after a successful save) would leak
          across cycles and disable the save button on reopen. */}
      {editing && (
        <PostEditorModal
          post={post}
          open={editing}
          onClose={() => setEditing(false)}
        />
      )}
      <PublishConfirmDialog
        open={confirming}
        postId={post.id}
        username={username}
        platform={platform}
        content={post.content}
        hashtags={post.hashtags ?? []}
        imageUrl={post.image_url}
        // 2026-05-24 #D-followup: pass per-config X-weighted cap so
        // the dialog uses the same cap the publisher gates on. Was
        // hardcoded 280 + raw .length comparison → false OK for JP.
        maxPostLength={post.ai_config?.max_post_length ?? 280}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
        onConfirm={publish}
        onAbort={abortPublish}
        onCopyPasteDone={() => {
          setConfirming(false);
          toast.success("コピペ投稿として記録しました");
          router.refresh();
        }}
        loading={busy === "publish"}
        publishError={error}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="投稿を削除"
        description={deleteLabel}
        confirmLabel="削除する"
        destructive
        loading={busy === "delete"}
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
