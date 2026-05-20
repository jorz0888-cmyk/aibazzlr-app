import { createClient } from "@/lib/supabase/server";
import { listAiConfigsByUser } from "@/lib/db/ai-configs";
import { listSocialAccountsByUser } from "@/lib/db/social-accounts";
import { listPostsByUser, countPostsByUser } from "@/lib/db/posts";
import type { Post } from "@/lib/supabase/types";
import { PostsManager } from "./PostsManager";
import type { PostListItem } from "@/components/posts/types";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [posts, aiConfigs, socialAccounts, totalAll, totalDraft, totalPosted] =
    await Promise.all([
      listPostsByUser(supabase, user.id, { limit: 50 }),
      listAiConfigsByUser(supabase, user.id),
      listSocialAccountsByUser(supabase, user.id),
      countPostsByUser(supabase, user.id),
      countPostsByUser(supabase, user.id, "draft"),
      countPostsByUser(supabase, user.id, "posted"),
    ]);

  // Hydrate ai_config + social_account names for the client.
  const aiMap = new Map(aiConfigs.map((c) => [c.id, c]));
  const acctMap = new Map(socialAccounts.map((a) => [a.id, a]));

  const enriched: PostListItem[] = (posts as Post[]).map((p) => ({
    ...p,
    ai_config: p.ai_config_id
      ? (() => {
          const c = aiMap.get(p.ai_config_id);
          return c
            ? {
                id: c.id,
                name: c.name,
                account_mode: c.account_mode,
                max_post_length: c.max_post_length ?? 280,
              }
            : null;
        })()
      : null,
    social_account: p.social_account_id
      ? (() => {
          const a = acctMap.get(p.social_account_id);
          return a
            ? {
                id: a.id,
                username: a.username,
                display_name: a.display_name,
                platform: a.platform,
              }
            : null;
        })()
      : null,
  }));

  // Active accounts only for the generator dropdown.
  const activeAccounts = socialAccounts.filter((a) => a.status === "active");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
            ── POSTS
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
            投稿管理
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            AIで生成した下書きを確認・編集して、SNSへ投稿します。
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="累計" value={totalAll} />
        <Stat label="ドラフト" value={totalDraft} accent />
        <Stat label="投稿済" value={totalPosted} />
      </div>

      <PostsManager
        initialPosts={enriched}
        aiConfigs={aiConfigs}
        socialAccounts={activeAccounts}
      />
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
