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

export function TimelineActions({
  postId,
  status,
  externalUrl,
}: {
  postId: string;
  status: string;
  externalUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
