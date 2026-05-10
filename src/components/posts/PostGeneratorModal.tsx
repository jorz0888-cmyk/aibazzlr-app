"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import type { AiConfig, SocialAccount } from "@/lib/supabase/types";

type Props = {
  open: boolean;
  onClose: () => void;
  aiConfigs: AiConfig[];
  socialAccounts: SocialAccount[];
};

export function PostGeneratorModal({
  open,
  onClose,
  aiConfigs,
  socialAccounts,
}: Props) {
  const router = useRouter();
  const [aiConfigId, setAiConfigId] = useState(
    aiConfigs.find((c) => c.is_default)?.id ?? aiConfigs[0]?.id ?? "",
  );
  const [socialAccountId, setSocialAccountId] = useState(
    socialAccounts.find((a) => a.is_primary)?.id ??
      socialAccounts[0]?.id ??
      "",
  );
  const [theme, setTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function generate() {
    if (!aiConfigId || !socialAccountId) {
      setError("AI設定 と 投稿先アカウントを選んでください");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/posts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_config_id: aiConfigId,
          social_account_id: socialAccountId,
          theme: theme.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg space-y-5 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
            ── NEW DRAFT
          </p>
          <h2 className="mt-1 text-lg font-bold text-ink">
            新しい投稿を生成
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            AI設定と投稿先アカウントを選んで、ドラフトを作成します。
          </p>
        </div>

        {aiConfigs.length === 0 ? (
          <div className="err">
            利用可能なAI設定がありません。先に
            <a className="link-cyan" href="/dashboard/settings/ai/new">
              AI設定を作成
            </a>
            してください。
          </div>
        ) : null}
        {socialAccounts.length === 0 ? (
          <div className="err">
            連携済みSNSアカウントがありません。先に
            <a className="link-cyan" href="/dashboard/sns">
              X連携
            </a>
            を行ってください。
          </div>
        ) : null}

        <div>
          <label className="label">AI設定</label>
          <select
            className="input"
            value={aiConfigId}
            onChange={(e) => setAiConfigId(e.target.value)}
          >
            {aiConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.account_mode === "real" ? "🏪" : "🎭"} {c.name}
                {c.is_default ? "（デフォルト）" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">投稿先アカウント</label>
          <select
            className="input"
            value={socialAccountId}
            onChange={(e) => setSocialAccountId(e.target.value)}
          >
            {socialAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.is_primary ? "★ " : ""}
                {a.platform.toUpperCase()} · @{a.username}
                {a.display_name ? ` (${a.display_name})` : ""}
                {a.is_primary ? " — PRIMARY" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">テーマ（任意）</label>
          <input
            type="text"
            className="input"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="例：今日の日替わり、季節の挨拶... 空ならAIに任せます"
          />
        </div>

        {error && <div className="err">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={generate}
            disabled={
              loading ||
              !aiConfigId ||
              !socialAccountId ||
              aiConfigs.length === 0 ||
              socialAccounts.length === 0
            }
          >
            {loading ? <Spinner /> : "ドラフトを生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
