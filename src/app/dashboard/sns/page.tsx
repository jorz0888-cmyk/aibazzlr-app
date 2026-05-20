import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { listSocialAccountsByUser } from "@/lib/db/social-accounts";
import { XConnectButton } from "@/components/sns/XConnectButton";
import { SnsAccountCard } from "@/components/sns/SnsAccountCard";
import { SnsToast } from "./SnsToast";

export const dynamic = "force-dynamic";

export default async function SnsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const accounts = await listSocialAccountsByUser(supabase, user.id);
  const xAccounts = accounts.filter((a) => a.platform === "x");

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
          AIBazzlrからの自動投稿を有効化するため、SNSアカウントを連携してください。
        </p>
      </div>

      <Suspense fallback={null}>
        <SnsToast />
      </Suspense>

      {/* Available platforms */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          連携可能なSNS
        </h2>

        <div className="grid gap-3 lg:grid-cols-3">
          <PlatformCard
            label="X (Twitter)"
            description="ボタン1つで安全に連携。AIBazzlr から自動投稿できるようになります。"
            available
            badge={`${xAccounts.length} 件接続中`}
          >
            <XConnectButton />
          </PlatformCard>

          <PlatformCard
            label="Threads"
            description="Threads APIに対応次第リリース予定。"
            available={false}
          />
          <PlatformCard
            label="Instagram"
            description="Instagram Graph APIに対応次第リリース予定。"
            available={false}
          />
        </div>
      </section>

      {/* Connected accounts */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          連携済みアカウント ({accounts.length})
        </h2>

        {accounts.length === 0 ? (
          <div className="card grid place-items-center px-6 py-16 text-center">
            <div className="text-4xl">🔗</div>
            <h3 className="mt-3 text-base font-bold text-ink">
              まだ連携されたSNSはありません
            </h3>
            <p className="mt-2 max-w-sm text-sm text-ink-muted">
              上の「X (Twitter) を連携」ボタンから OAuth 認証を開始してください。
              認証後、AIBazzlr から自動で投稿できるようになります。
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {accounts.map((a) => (
              <SnsAccountCard key={a.id} account={a} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlatformCard({
  label,
  description,
  available,
  badge,
  children,
}: {
  label: string;
  description: string;
  available: boolean;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={[
        "card flex flex-col gap-3 p-5 transition",
        available ? "hover:border-cyan/30" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-ink">{label}</h3>
        {available ? (
          badge && (
            <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-widest text-cyan">
              {badge}
            </span>
          )
        ) : (
          <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[9px] tracking-widest text-ink-subtle">
            COMING SOON
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-auto pt-2">{children}</div>
    </div>
  );
}
