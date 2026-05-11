"use client";

import { useMemo, useState } from "react";
import { PostCard } from "@/components/posts/PostCard";
import { PostGeneratorModal } from "@/components/posts/PostGeneratorModal";
import type { PostListItem } from "@/components/posts/types";
import type { AiConfig, PostStatus, SocialAccount } from "@/lib/supabase/types";

const STATUS_FILTERS: {
  key: "all" | PostStatus;
  label: string;
}[] = [
  { key: "all", label: "すべて" },
  { key: "draft", label: "ドラフト" },
  { key: "publishing", label: "処理中" },
  { key: "posted", label: "投稿済" },
  { key: "failed", label: "失敗" },
];

export function PostsManager({
  initialPosts,
  aiConfigs,
  socialAccounts,
}: {
  initialPosts: PostListItem[];
  aiConfigs: AiConfig[];
  socialAccounts: SocialAccount[];
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | PostStatus>("all");
  const [aiFilter, setAiFilter] = useState<string>("all");
  const [genOpen, setGenOpen] = useState(false);

  const filtered = useMemo(() => {
    return initialPosts.filter((p) => {
      if (statusFilter !== "all") {
        const matches =
          p.status === statusFilter ||
          (statusFilter === "posted" && p.status === "published");
        if (!matches) return false;
      }
      if (aiFilter !== "all" && p.ai_config_id !== aiFilter) return false;
      return true;
    });
  }, [initialPosts, statusFilter, aiFilter]);

  const grouped = useMemo(() => {
    const drafts: PostListItem[] = [];
    const publishing: PostListItem[] = [];
    const posted: PostListItem[] = [];
    const failed: PostListItem[] = [];
    const others: PostListItem[] = [];
    for (const p of filtered) {
      if (p.status === "draft") drafts.push(p);
      else if (p.status === "publishing") publishing.push(p);
      else if (p.status === "posted" || p.status === "published") posted.push(p);
      else if (p.status === "failed") failed.push(p);
      else others.push(p);
    }
    return { drafts, publishing, posted, failed, others };
  }, [filtered]);

  return (
    <>
      <div className="card flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label !mb-1">ステータス</label>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | PostStatus)
              }
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label !mb-1">AI設定</label>
            <select
              className="input"
              value={aiFilter}
              onChange={(e) => setAiFilter(e.target.value)}
            >
              <option value="all">すべてのAI設定</option>
              {aiConfigs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.account_mode === "real" ? "🏪" : "🎭"} {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => setGenOpen(true)}
        >
          + 新しい投稿を生成
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center">
          <div className="text-4xl">📝</div>
          <h2 className="mt-3 text-base font-bold text-ink">
            投稿がまだありません
          </h2>
          <p className="mt-2 max-w-sm text-sm text-ink-muted">
            「+ 新しい投稿を生成」から、AIにドラフトを書いてもらいましょう。
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.drafts.length > 0 && (
            <Group title="ドラフト" count={grouped.drafts.length}>
              {grouped.drafts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </Group>
          )}
          {grouped.publishing.length > 0 && (
            <Group title="処理中" count={grouped.publishing.length}>
              {grouped.publishing.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </Group>
          )}
          {grouped.failed.length > 0 && (
            <Group title="失敗" count={grouped.failed.length}>
              {grouped.failed.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </Group>
          )}
          {grouped.posted.length > 0 && (
            <Group title="投稿済" count={grouped.posted.length}>
              {grouped.posted.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </Group>
          )}
          {grouped.others.length > 0 && (
            <Group title="その他" count={grouped.others.length}>
              {grouped.others.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </Group>
          )}
        </div>
      )}

      <PostGeneratorModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        aiConfigs={aiConfigs}
        socialAccounts={socialAccounts}
      />
    </>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
        {title} <span className="text-ink-subtle">({count})</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
