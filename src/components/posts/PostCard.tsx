"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { PostEditorModal } from "./PostEditorModal";
import { PublishConfirmDialog } from "./PublishConfirmDialog";
import type { PostListItem } from "./types";

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
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | "publish" | "delete" | "retry">(null);
  const [error, setError] = useState<string | null>(null);

  const username = post.social_account?.username ?? "(unknown)";
  const platform = post.social_account?.platform ?? "x";
  const aiName = post.ai_config?.name ?? "(AI設定なし)";
  const aiMode = post.ai_config?.account_mode === "fictional" ? "🎭" : "🏪";

  async function publish() {
    setBusy("publish");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        warning?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "投稿に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/retry`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "再試行に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("このドラフトを削除しますか？")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(null);
    }
  }

  // Status-specific styling
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
          label: "投稿中",
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
        </header>

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
                onClick={remove}
                disabled={busy !== null}
              >
                {busy === "delete" ? <Spinner size={14} /> : "削除"}
              </button>
            </>
          )}
          {post.status === "failed" && (
            <button
              type="button"
              className="btn-primary"
              onClick={retry}
              disabled={busy !== null}
            >
              {busy === "retry" ? <Spinner /> : "再試行"}
            </button>
          )}
        </footer>
        {/*
          Cost / model info is intentionally hidden from the UI.
          The data is still persisted in `generation_metadata` for monthly
          cost tracking, anomaly detection, and the future Phase 9 "usage"
          dashboard (incl. BYOK plans where re-display might be desired).
        */}
      </article>

      <PostEditorModal
        post={post}
        open={editing}
        onClose={() => setEditing(false)}
      />
      <PublishConfirmDialog
        open={confirming}
        username={username}
        platform={platform}
        content={post.content}
        hashtags={post.hashtags ?? []}
        onCancel={() => setConfirming(false)}
        onConfirm={publish}
        loading={busy === "publish"}
      />
    </>
  );
}
