import { createClient } from "@/lib/supabase/server";
import { listPostsByUser, countPostsByUser } from "@/lib/db/posts";
import type { Post, PostStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const statusLabel: Record<PostStatus, string> = {
  draft: "下書き",
  scheduled: "予約済み",
  publishing: "投稿中",
  published: "投稿完了",
  failed: "失敗",
  cancelled: "キャンセル",
};

const statusClass: Record<PostStatus, string> = {
  draft: "border-line-strong text-ink-muted bg-white/5",
  scheduled: "border-cyan/30 text-cyan bg-cyan/10",
  publishing: "border-yellow-400/30 text-yellow-400 bg-yellow-400/10",
  published: "border-success/30 text-success bg-success/10",
  failed: "border-danger/30 text-danger bg-danger/10",
  cancelled: "border-line-strong text-ink-subtle bg-white/5",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [posts, totalAll, totalScheduled, totalPublished] = await Promise.all([
    listPostsByUser(supabase, user.id, { limit: 50 }),
    countPostsByUser(supabase, user.id),
    countPostsByUser(supabase, user.id, "scheduled"),
    countPostsByUser(supabase, user.id, "published"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── POSTS
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          投稿履歴
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          AIが生成・予約・公開した投稿の一覧。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="累計" value={totalAll} />
        <Stat label="予約中" value={totalScheduled} accent />
        <Stat label="公開済み" value={totalPublished} />
      </div>

      {posts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="px-5 py-3 font-semibold">ステータス</th>
                <th className="px-5 py-3 font-semibold">内容</th>
                <th className="px-5 py-3 font-semibold">予定/公開</th>
                <th className="px-5 py-3 font-semibold">作成</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
        {label.toUpperCase()}
      </div>
      <div
        className={[
          "mt-2 text-3xl font-extrabold",
          accent ? "text-cyan" : "text-ink",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function PostRow({ post }: { post: Post }) {
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-white/[0.015]">
      <td className="px-5 py-4 align-top">
        <span
          className={[
            "inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider",
            statusClass[post.status],
          ].join(" ")}
        >
          {statusLabel[post.status]}
        </span>
      </td>
      <td className="px-5 py-4 align-top">
        <div className="line-clamp-2 max-w-[420px] text-ink">
          {post.content}
        </div>
        {post.error_message && (
          <div className="mt-1 text-[11px] text-danger">
            ⚠ {post.error_message}
          </div>
        )}
      </td>
      <td className="px-5 py-4 align-top font-mono text-[12px] text-ink-muted">
        {post.status === "published"
          ? fmtDate(post.published_at)
          : fmtDate(post.scheduled_at)}
      </td>
      <td className="px-5 py-4 align-top font-mono text-[12px] text-ink-subtle">
        {fmtDate(post.created_at)}
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="text-4xl">📝</div>
      <h2 className="mt-3 text-base font-bold text-ink">
        まだ投稿はありません
      </h2>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        AI設定とSNS連携が完了すると、ここに投稿履歴が表示されます。
      </p>
    </div>
  );
}
