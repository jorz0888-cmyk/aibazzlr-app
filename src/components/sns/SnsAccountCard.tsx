"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import type { SocialAccount } from "@/lib/supabase/types";

const PLATFORM_META: Record<
  SocialAccount["platform"],
  { label: string; emoji: string; bg: string }
> = {
  x: { label: "X", emoji: "𝕏", bg: "bg-black border border-white/20" },
  threads: {
    label: "Threads",
    emoji: "@",
    bg: "bg-black border border-white/20",
  },
  instagram: {
    label: "Instagram",
    emoji: "◉",
    bg: "bg-gradient-to-br from-[#f09433] via-[#dc2743] to-[#bc1888]",
  },
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

export function SnsAccountCard({ account }: { account: SocialAccount }) {
  const router = useRouter();
  const [loading, setLoading] = useState<
    null | "disconnect" | "primary" | "reauth"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const meta = PLATFORM_META[account.platform];

  // Phase 7-2: tokens are now auto-refreshed by getValidAccessToken at
  // publish-time. So a "near-expiry" timestamp is NOT a problem — only
  // the explicit `token_invalid` status (set when refresh itself fails)
  // needs user intervention. We keep the time-based check around purely
  // for legacy data where the status field wasn't yet populated.
  const isTokenInvalid =
    account.status === "token_invalid" || account.status === "error";
  const isDisconnected = account.status === "disconnected";
  const status = isTokenInvalid
    ? "token_invalid"
    : isDisconnected
      ? "disconnected"
      : account.status;

  async function disconnect() {
    if (loading) return;
    setError(null);
    setLoading("disconnect");
    try {
      const res = await fetch("/api/auth/x/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialAccountId: account.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        debug?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(
          body.error ?? body.debug?.message ?? `HTTP ${res.status}`,
        );
      }
      setDisconnectOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除に失敗しました");
      setLoading(null);
    }
  }

  async function reconnect() {
    if (loading) return;
    setError(null);
    setLoading("reauth");
    try {
      const res = await fetch("/api/auth/x/login", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        redirect_url?: string;
        error?: string;
      };
      if (res.ok && body.redirect_url) {
        window.location.href = body.redirect_url;
        return;
      }
      throw new Error(body.error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "再連携に失敗しました");
      setLoading(null);
    }
  }

  async function setAsPrimary() {
    if (loading) return;
    setError(null);
    setLoading("primary");
    try {
      const res = await fetch(
        `/api/social-accounts/${account.id}/primary`,
        { method: "PATCH" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PRIMARY 切替に失敗しました");
      setLoading(null);
    }
  }

  return (
    <li className="card flex flex-wrap items-center gap-4 p-5 transition hover:border-cyan/30">
      {/* Avatar */}
      {account.profile_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={account.profile_image_url}
          alt=""
          className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
        />
      ) : (
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-base font-bold text-white ${meta.bg}`}
          aria-hidden
        >
          {meta.emoji}
        </div>
      )}

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-bold text-ink">
            {account.display_name ?? account.username}
          </span>
          <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-widest text-ink-muted">
            {meta.label}
          </span>
          {account.is_primary && (
            <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-widest text-cyan">
              PRIMARY
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>@{account.username}</span>
          <span className="text-ink-subtle">·</span>
          <span>最終同期: {relativeTime(account.last_synced_at)}</span>
        </div>
      </div>

      {/* Status */}
      <div className="text-right">
        {status === "active" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            ● 接続済み（自動更新中）
          </span>
        ) : status === "token_invalid" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
            ⚠️ 再連携が必要です
          </span>
        ) : status === "disconnected" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
            ● 切断済み
          </span>
        ) : status === "expired" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-400">
            ⚠️ トークン期限切れ（次回投稿時に自動更新）
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
            ● {status}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {status === "token_invalid" && (
          <button
            type="button"
            onClick={reconnect}
            disabled={loading !== null}
            className="btn-primary"
          >
            {loading === "reauth" ? <Spinner size={14} /> : "🔄 再連携する"}
          </button>
        )}
        {!account.is_primary && status === "active" && (
          <button
            type="button"
            onClick={setAsPrimary}
            disabled={loading !== null}
            className="btn-secondary"
          >
            {loading === "primary" ? (
              <Spinner size={14} />
            ) : (
              "PRIMARY に設定"
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDisconnectOpen(true)}
          disabled={loading !== null}
          className="btn-secondary border-danger/30 text-danger hover:bg-danger/10"
        >
          {loading === "disconnect" ? <Spinner size={14} /> : "連携解除"}
        </button>
      </div>

      {error && (
        <div className="basis-full text-xs text-danger">{error}</div>
      )}

      {account.platform === "x" && (
        <Oauth1ManualKeyPanel account={account} />
      )}

      <ConfirmDialog
        open={disconnectOpen}
        title="連携を解除"
        description={
          <>
            <span className="font-bold text-cyan">@{account.username}</span>{" "}
            の連携を解除しますか？
            <br />
            再連携は再度 X での認証が必要です。
          </>
        }
        confirmLabel="解除する"
        destructive
        loading={loading === "disconnect"}
        onConfirm={disconnect}
        onCancel={() => setDisconnectOpen(false)}
      />
    </li>
  );
}

/**
 * Admin-only escape hatch: paste OAuth 1.0a Access Token + Secret minted in
 * the X Developer Portal so the publisher switches this account onto the
 * OAuth 1.0a path (v1.1 media upload + v2 tweet posting). Mirrors n8n's
 * known-good auth model. Required while the 3-legged 1.0a connect flow is
 * blocked by X's 415 "Callback URL not approved" issue.
 *
 * Backed by POST /api/social-accounts/[id]/oauth1 (cb0f9cd).
 */
function Oauth1ManualKeyPanel({ account }: { account: SocialAccount }) {
  const router = useRouter();
  const toast = useToast();
  const isSet = Boolean(account.oauth1_access_token);
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!token.trim() || !secret.trim()) {
      setErr("Access Token と Token Secret の両方を入力してください");
      return;
    }
    setErr(null);
    setBusy("save");
    try {
      const res = await fetch(`/api/social-accounts/${account.id}/oauth1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: token.trim(),
          access_token_secret: secret.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("OAuth 1.0a キーを保存しました", {
        description: `@${account.username} は完全自動投稿が有効になりました`,
      });
      setToken("");
      setSecret("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    if (!confirm(`@${account.username} の OAuth 1.0a キーを削除しますか？`)) {
      return;
    }
    setErr(null);
    setBusy("clear");
    try {
      const res = await fetch(`/api/social-accounts/${account.id}/oauth1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.info("OAuth 1.0a キーを削除しました", {
        description: `@${account.username} は OAuth 2.0 経路に戻ります`,
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="basis-full">
      <summary className="cursor-pointer rounded-md border border-line bg-white/5 p-2 text-[11px] text-ink-muted transition hover:border-cyan/30 hover:text-ink">
        <span className="font-mono tracking-wider">OAuth 1.0a キー</span>
        <span
          className={[
            "ml-2 rounded-full px-2 py-0.5 font-mono text-[9px] tracking-widest",
            isSet
              ? "bg-cyan/15 text-cyan"
              : "border border-line-strong bg-white/5 text-ink-subtle",
          ].join(" ")}
        >
          {isSet ? "設定済み — 完全自動 ON" : "未設定 — OAuth 2.0 経路"}
        </span>
        <span className="ml-2 text-[10px] text-ink-subtle">
          （管理者向け · 画像付き完全自動投稿）
        </span>
      </summary>

      <div className="mt-3 space-y-3 rounded-md border border-line bg-bg/40 p-3">
        <p className="text-[11px] leading-relaxed text-ink-subtle">
          X Developer Portal →「Keys and tokens」→「Access Token and Secret」で
          発行した <b className="text-ink">Access Token</b> と{" "}
          <b className="text-ink">Token Secret</b> をここに貼り付けます。
          保存すると、このアカウントの投稿が v1.1 画像アップロード + v2 ツイート
          (どちらも OAuth 1.0a) に切り替わり、画像付きの完全自動投稿が成功します。
          Consumer Key / Secret は環境変数（X_CONSUMER_KEY /
          X_CONSUMER_SECRET）を使用するため入力不要です。
        </p>

        <div>
          <label className="label !mb-1 block text-[11px]">Access Token</label>
          <input
            type={show ? "text" : "password"}
            className="input font-mono text-xs"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={isSet ? "（保存済 — 上書きするには再入力）" : ""}
            disabled={busy !== null}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label !mb-1 block text-[11px]">
            Access Token Secret
          </label>
          <input
            type={show ? "text" : "password"}
            className="input font-mono text-xs"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={isSet ? "（保存済 — 上書きするには再入力）" : ""}
            disabled={busy !== null}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={save}
            disabled={busy !== null || (!token && !secret)}
          >
            {busy === "save" ? (
              <Spinner size={12} />
            ) : isSet ? (
              "保存して上書き"
            ) : (
              "保存して完全自動を有効化"
            )}
          </button>
          {isSet && (
            <button
              type="button"
              className="btn-secondary text-xs text-danger"
              onClick={clear}
              disabled={busy !== null}
            >
              {busy === "clear" ? <Spinner size={12} /> : "クリア"}
            </button>
          )}
          <label className="ml-auto flex items-center gap-1 text-[10px] text-ink-subtle">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
            />
            表示
          </label>
        </div>

        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </details>
  );
}
