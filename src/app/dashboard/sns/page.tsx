import { createClient } from "@/lib/supabase/server";
import { listSocialAccountsByUser } from "@/lib/db/social-accounts";
import type { Platform, SocialAccount } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const platformMeta: Record<Platform, { label: string; bg: string }> = {
  x: { label: "X", bg: "bg-black border border-white/20" },
  threads: { label: "Threads", bg: "bg-black border border-white/20" },
  instagram: {
    label: "Instagram",
    bg: "bg-gradient-to-br from-[#f09433] via-[#dc2743] to-[#bc1888]",
  },
};

const statusLabel: Record<SocialAccount["status"], string> = {
  active: "稼働中",
  expired: "トークン期限切れ",
  disconnected: "切断済み",
  error: "エラー",
};

const statusColor: Record<SocialAccount["status"], string> = {
  active: "text-success",
  expired: "text-yellow-400",
  disconnected: "text-ink-muted",
  error: "text-danger",
};

export default async function SnsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const accounts = await listSocialAccountsByUser(supabase, user.id);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── SOCIAL ACCOUNTS
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          SNS連携
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          X・Threads・InstagramをAIBazzlrに接続して、自動投稿を有効化します。
        </p>
      </div>

      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled>
          + 新規連携を追加
        </button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-3">
          {accounts.map((a) => {
            const meta = platformMeta[a.platform];
            return (
              <li
                key={a.id}
                className="card flex items-center gap-4 p-5 transition hover:border-cyan/30"
              >
                <div
                  className={[
                    "grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-bold text-white",
                    meta.bg,
                  ].join(" ")}
                  aria-hidden
                >
                  {meta.label[0]}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">
                      @{a.username}
                    </span>
                    {a.is_primary && (
                      <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-cyan">
                        PRIMARY
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {meta.label}
                    {a.display_name && ` · ${a.display_name}`}
                  </div>
                </div>

                <div className="hidden text-right sm:block">
                  <div
                    className={`text-xs font-semibold ${statusColor[a.status]}`}
                  >
                    ● {statusLabel[a.status]}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-subtle">
                    {new Date(a.connected_at).toLocaleDateString("ja-JP")}〜
                  </div>
                </div>

                <button type="button" className="btn-ghost" disabled>
                  管理
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="text-4xl">🔗</div>
      <h2 className="mt-3 text-base font-bold text-ink">
        まだSNSが連携されていません
      </h2>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        X・Threads・Instagramを連携すると、AIによる自動投稿が利用可能になります。
      </p>
      <button type="button" className="btn-primary mt-6" disabled>
        最初のアカウントを連携する
      </button>
      <span className="mt-3 font-mono text-[10px] tracking-widest text-ink-subtle">
        OAUTH連携機能は実装準備中
      </span>
    </div>
  );
}
