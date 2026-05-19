"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";

async function postJson(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

async function deleteJson(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

function buildXComposeUrl(text: string): string {
  // X's official share-intent URL — supports prefilled text, stable since
  // the Twitter days. The /compose/post path only works for signed-in users
  // and silently drops the param in some clients.
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function TimelineActions({
  postId,
  status,
  externalUrl,
  tweetText,
}: {
  postId: string;
  status: string;
  externalUrl: string | null;
  tweetText: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "approve" | "reject" | "mark" | "delete" | "copy" | null
  >(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function approve() {
    setErr(null);
    setBusy("approve");
    try {
      await postJson(`/api/posts/${postId}/approve`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "承認に失敗しました");
      setBusy(null);
    }
  }
  async function reject() {
    setErr(null);
    if (!confirm("この投稿を却下しますか？")) return;
    setBusy("reject");
    try {
      await postJson(`/api/posts/${postId}/reject`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "却下に失敗しました");
      setBusy(null);
    }
  }
  async function markPosted() {
    setErr(null);
    setBusy("mark");
    try {
      await postJson(`/api/posts/${postId}/mark-as-posted`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新に失敗しました");
      setBusy(null);
    }
  }
  async function deletePost() {
    setErr(null);
    if (!confirm("この投稿を削除しますか？")) return;
    setBusy("delete");
    try {
      await deleteJson(`/api/posts/${postId}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(null);
    }
  }
  async function copyText() {
    if (!tweetText) return;
    setErr(null);
    try {
      await navigator.clipboard.writeText(tweetText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "コピーに失敗しました");
    }
  }

  if (status === "pending_approval") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={approve}
          disabled={busy !== null}
        >
          {busy === "approve" ? <Spinner /> : "承認して投稿"}
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={reject}
          disabled={busy !== null}
        >
          {busy === "reject" ? <Spinner /> : "却下"}
        </button>
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </div>
    );
  }

  if (status === "awaiting_manual_post" && tweetText) {
    return (
      <div className="mt-2 space-y-2">
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-white/5 p-3 font-sans text-[12px] leading-relaxed text-ink">
          {tweetText}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={copyText}
            disabled={busy !== null}
          >
            {copied ? "コピー済み ✓" : "📋 本文をコピー"}
          </button>
          <a
            href={buildXComposeUrl(tweetText)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs"
          >
            🔗 X で開く
          </a>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={markPosted}
            disabled={busy !== null}
          >
            {busy === "mark" ? <Spinner /> : "✅ 投稿しました"}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={deletePost}
            disabled={busy !== null}
          >
            {busy === "delete" ? <Spinner /> : "削除"}
          </button>
          {err && <span className="text-[11px] text-danger">{err}</span>}
        </div>
        <p className="text-[10px] text-ink-subtle">
          「X で開く」は投稿画面を新しいタブで開き、本文を自動で貼り付けます。送信後にこのカードへ戻り「投稿しました」を押してください。
        </p>
      </div>
    );
  }

  if (status === "posted" && externalUrl) {
    return (
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="link-cyan mt-1 inline-block text-[11px]"
      >
        X で見る →
      </a>
    );
  }

  return null;
}
