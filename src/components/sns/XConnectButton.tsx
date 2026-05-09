"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";

export function XConnectButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/x/login", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        redirect_url?: string;
        error?: string;
        debug?: { message?: string };
      };

      if (res.ok && data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }

      const msg =
        data.error ??
        data.debug?.message ??
        `連携の開始に失敗しました (HTTP ${res.status})`;
      throw new Error(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleConnect}
        disabled={loading}
        className="btn-primary inline-flex items-center gap-2"
      >
        {loading ? (
          <Spinner size={14} />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        )}
        {loading ? "接続中..." : "X (Twitter) を連携"}
      </button>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
