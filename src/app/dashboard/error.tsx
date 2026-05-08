"use client";

import { useEffect } from "react";

/**
 * Error boundary for /dashboard/* routes. Server-side exceptions inside
 * page.tsx render this fallback instead of the bare Next.js error page.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Send to telemetry once we wire it up (Sentry, Logsnag, etc.).
    console.error("[dashboard:error]", error);
  }, [error]);

  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="mt-3 text-lg font-bold text-ink">
        ページの読み込み中にエラーが発生しました
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        一時的な問題の可能性があります。お手数ですが再読み込みをお試しください。
        繰り返し発生する場合はサポートまでご連絡ください。
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[10px] tracking-wider text-ink-subtle">
          digest: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={() => reset()} className="btn-primary">
          再試行
        </button>
        <a href="/dashboard" className="btn-secondary">
          ダッシュボードへ
        </a>
      </div>
    </div>
  );
}
