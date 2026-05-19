import { createClient } from "@/lib/supabase/server";
import { MONTHLY_GOALS } from "@/lib/strategy/monthly-goals";
import type { AiConfig, Post } from "@/lib/supabase/types";

/**
 * Tiny per-AI-config monthly-goal recap card. Shows the configured goal
 * plus a couple of behavioural stats from this calendar month so the user
 * can see "AI is operating against my goal". Full effect metrics
 * (follower growth, engagement) are out of scope for Phase 13.
 */
export async function StrategyProgress({ userId }: { userId: string }) {
  const supabase = await createClient();

  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );

  const { data: configsRaw } = await supabase
    .from("ai_configs")
    .select(
      "id, name, monthly_goal, target_audience_preset, account_mode",
    )
    .eq("user_id", userId)
    .not("monthly_goal", "is", null);
  const configs = (configsRaw ?? []) as AiConfig[];
  if (configs.length === 0) return null;

  const { data: postsRaw } = await supabase
    .from("posts")
    .select("id, ai_config_id, posted_at, created_at, content")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString())
    .in("status", ["posted", "published", "posted_manually"]);
  const posts = (postsRaw ?? []) as Post[];

  return (
    <section className="card p-5">
      <p className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
        STRATEGY · THIS MONTH
      </p>
      <h2 className="mt-1 text-base font-bold text-ink">今月の目標進捗</h2>
      <ul className="mt-4 space-y-3">
        {configs.map((c) => {
          const goal = c.monthly_goal ? MONTHLY_GOALS[c.monthly_goal] : null;
          const cposts = posts.filter((p) => p.ai_config_id === c.id);
          const weekday = cposts.filter((p) => {
            const date = new Date(p.posted_at ?? p.created_at);
            const wd = date.getDay();
            return wd >= 1 && wd <= 4; // 月-木
          });
          const avgLen =
            cposts.length > 0
              ? Math.round(
                  cposts.reduce((acc, p) => acc + (p.content?.length ?? 0), 0) /
                    cposts.length,
                )
              : 0;
          return (
            <li
              key={c.id}
              className="rounded-lg border border-line bg-white/5 p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{c.name}</p>
                  <p className="text-[11px] text-ink-subtle">
                    {goal?.label ?? "（目標未設定）"}
                  </p>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-ink-muted">
                  {cposts.length} 件投稿
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-ink-subtle">
                <div>
                  <dt>月-木</dt>
                  <dd className="font-mono text-ink">{weekday.length}</dd>
                </div>
                <div>
                  <dt>平均文字数</dt>
                  <dd className="font-mono text-ink">{avgLen || "—"}</dd>
                </div>
                <div>
                  <dt>客層</dt>
                  <dd className="truncate text-[10px] text-ink">
                    {c.target_audience_preset ?? "—"}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] text-ink-subtle">
        ※ フォロワー増・エンゲージメント率などの効果測定は今後のフェーズで対応します。
      </p>
    </section>
  );
}
