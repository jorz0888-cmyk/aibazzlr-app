"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";

/**
 * Phase 15: new connections go through the 3-legged OAuth 1.0a flow at
 * /api/auth/x/oauth1/start (302 → X authorize page). The old OAuth 2.0
 * route at /api/auth/x/login is intentionally left in place so accounts
 * connected before this change keep working through the publisher's
 * resolveXAuth() fallback.
 */
export function XConnectButton() {
  const [loading, setLoading] = useState(false);

  function handleConnect() {
    setLoading(true);
    // Top-level navigation — /api/auth/x/oauth1/start responds with a 302
    // to X's authorize URL, so a fetch would not follow the redirect into
    // a different origin.
    window.location.href = "/api/auth/x/oauth1/start";
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
    </div>
  );
}
