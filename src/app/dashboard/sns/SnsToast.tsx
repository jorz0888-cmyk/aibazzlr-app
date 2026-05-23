"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const ERROR_LABELS: Record<string, string> = {
  missing_params: "認証パラメータが不足していました",
  invalid_state: "認証セッションが無効、または期限切れです（10分以内に完了してください）",
  unauthorized: "認証セッションが切れています。再度ログインしてください",
  save_failed: "DBへの保存に失敗しました",
  callback_failed: "OAuth コールバック処理でエラーが発生しました",
  session_lookup_failed: "セッション検証中にエラーが発生しました",
  server_misconfigured: "サーバ設定（環境変数）が不足しています",
  access_denied: "X側で認可がキャンセルされました",
  // Phase 18: the same X account was already linked from another
  // AIBazzlr user. The callback supplies a `detail` line that names
  // the X handle and tells the visitor what to do next.
  x_account_already_linked: "この X アカウントは別の AIBazzlr アカウントで連携中です",
  oauth1_save_failed: "OAuth 1.0a の保存に失敗しました",
};

export function SnsToast() {
  const router = useRouter();
  const search = useSearchParams();
  const [show, setShow] = useState(true);

  const connected = search.get("connected");
  const error = search.get("error");
  const detail = search.get("detail");

  useEffect(() => {
    setShow(true);
  }, [connected, error, detail]);

  if (!show || (!connected && !error)) return null;

  function dismiss() {
    setShow(false);
    // Strip query so refresh doesn't re-show.
    router.replace("/dashboard/sns");
  }

  if (connected) {
    return (
      <div
        className="card flex items-start gap-3 border-success/30 bg-success/5 p-4"
        role="status"
      >
        <span className="text-xl" aria-hidden>
          ✅
        </span>
        <div className="flex-1 text-sm text-ink">
          <strong className="text-success">
            {connected.toUpperCase()} の連携が完了しました
          </strong>
          <p className="mt-0.5 text-xs text-ink-muted">
            これでAIが自動投稿に使えるアカウントとして登録されました。
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-ink-subtle hover:text-ink"
          aria-label="閉じる"
        >
          ×
        </button>
      </div>
    );
  }

  if (error) {
    const label = ERROR_LABELS[error] ?? `エラー: ${error}`;
    return (
      <div
        className="card flex items-start gap-3 border-danger/30 bg-danger/5 p-4"
        role="alert"
      >
        <span className="text-xl" aria-hidden>
          ⚠️
        </span>
        <div className="flex-1 text-sm text-ink">
          <strong className="text-danger">{label}</strong>
          {detail && (
            <details className="mt-1 text-[11px] text-ink-muted">
              <summary className="cursor-pointer">技術的な詳細</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all">
                {detail}
              </pre>
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-ink-subtle hover:text-ink"
          aria-label="閉じる"
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}
