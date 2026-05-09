"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = PLATFORM_META[account.platform];
  const expired =
    account.token_expires_at &&
    new Date(account.token_expires_at).getTime() < Date.now();
  const status = expired ? "expired" : account.status;

  async function disconnect() {
    if (loading) return;
    if (
      !window.confirm(
        `@${account.username} の連携を解除しますか？\n（再連携は再度認証が必要です）`,
      )
    )
      return;
    setError(null);
    setLoading(true);
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除に失敗しました");
      setLoading(false);
    }
  }

  return (
    <li className="card flex flex-wrap items-center gap-4 p-5 transition hover:border-cyan/30">
      {/* Avatar */}
      {account.profile_image_url ?? account.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={
            (account.profile_image_url ?? account.avatar_url) as string
          }
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
            ● 接続済み
          </span>
        ) : status === "expired" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-400">
            ⚠️ トークン期限切れ
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
            ● {status}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={disconnect}
          disabled={loading}
          className="btn-secondary border-danger/30 text-danger hover:bg-danger/10"
        >
          {loading ? <Spinner size={14} /> : "連携解除"}
        </button>
      </div>

      {error && (
        <div className="basis-full text-xs text-danger">{error}</div>
      )}
    </li>
  );
}
