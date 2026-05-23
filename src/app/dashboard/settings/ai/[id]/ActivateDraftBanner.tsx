"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";

/**
 * 2026-05-23 bug-4 follow-up: in-place draft→active activation from
 * the AI設定 detail page. Previously the only way to activate a draft
 * was to re-visit the hearing preview page and press "この設定を
 * 有効化する" — users who arrived at the detail page from the
 * AI設定 list had no path forward.
 */
export function ActivateDraftBanner({ configId }: { configId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function activate() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-configs/${configId}/activate`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      toast.success("AI設定を有効化しました", {
        description: "投稿生成にこの設定を使えるようになりました",
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "有効化に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-warning/40 bg-warning/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-warning">
            この設定は『下書き』です — まだ投稿生成には使われません
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            ヒアリングで生成された内容を確認・編集したあと、有効化すると
            自動投稿・手動生成の対象になります。
          </p>
          {err && <p className="mt-2 text-xs text-danger whitespace-pre-line">{err}</p>}
        </div>
        <button
          type="button"
          onClick={activate}
          disabled={busy}
          className="btn-primary shrink-0 text-xs"
        >
          {busy ? <Spinner size={12} /> : "この設定を有効化する →"}
        </button>
      </div>
    </div>
  );
}
