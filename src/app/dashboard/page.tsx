import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listSocialAccountsByUser } from "@/lib/db/social-accounts";
import { listAiConfigsByUser } from "@/lib/db/ai-configs";
import { countPostsByUser } from "@/lib/db/posts";
import { checkMonthlyPostQuota } from "@/lib/quota";
import { PLAN_DISPLAY_NAMES } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch dashboard stats with isolated failures so a single bad query
  // doesn't crash the whole landing page.
  const [snsRes, configsRes, postsCountRes, quotaRes] = await Promise.allSettled([
    listSocialAccountsByUser(supabase, user.id),
    listAiConfigsByUser(supabase, user.id),
    countPostsByUser(supabase, user.id, "posted"),
    checkMonthlyPostQuota(user.id),
  ]);

  const snsCount =
    snsRes.status === "fulfilled" ? snsRes.value.length : 0;
  const configsCount =
    configsRes.status === "fulfilled" ? configsRes.value.length : 0;
  const publishedThisMonth =
    postsCountRes.status === "fulfilled" ? postsCountRes.value : 0;
  const quota =
    quotaRes.status === "fulfilled" ? quotaRes.value : null;

  const hasSns = snsCount > 0;
  const hasAiConfig = configsCount > 0;

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── DASHBOARD
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          ようこそ、
          <span className="text-cyan">{user.email}</span> さん 👋
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          AIBazzlrへようこそ。SNS連携とAI設定を済ませて、自動投稿を始めましょう。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="連携済みSNS" value={snsCount} unit="アカウント" />
        <Stat label="AI設定" value={configsCount} unit="件" />
        <Stat label="今月の自動投稿" value={publishedThisMonth} unit="件" />
      </div>

      {quota && (
        <div className="card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
                CURRENT PLAN · {PLAN_DISPLAY_NAMES[quota.plan].toUpperCase()}
              </p>
              <h2 className="mt-1 text-base font-bold text-ink">
                今期の投稿生成: {quota.used} / {quota.limit}
              </h2>
              <p className="mt-1 text-xs text-ink-subtle">
                次回リセット: {quota.resetAt.toLocaleDateString("ja-JP")}
              </p>
            </div>
            <Link href="/dashboard/billing" className="link-cyan text-sm">
              プランを見る →
            </Link>
          </div>
          <UsageBar value={quota.used} max={quota.limit} />
          {quota.remaining <= Math.ceil(quota.limit * 0.1) && (
            <p className="mt-3 text-xs text-warning">
              残り {quota.remaining} 件です。アップグレードで上限を引き上げできます。
            </p>
          )}
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-base font-bold text-ink">次のステップ</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <Step n={1} done>
            アカウント作成
          </Step>
          <Step n={2} done={hasSns} href="/dashboard/sns">
            SNSアカウントを連携する
          </Step>
          <Step n={3} done={hasAiConfig} href="/dashboard/settings/ai">
            AI設定でブランドを定義する
          </Step>
          <Step n={4}>
            AIに自動投稿を任せる
            <span className="ml-2 rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[9px] tracking-wider text-ink-subtle">
              PHASE 5
            </span>
          </Step>
        </ol>
      </div>
    </div>
  );
}

function UsageBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = pct >= 90;
  const warn = pct >= 75 && !danger;
  const color = danger ? "bg-danger" : warn ? "bg-warning" : "bg-cyan";
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <div className="card p-5">
      <div className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
        {label.toUpperCase()}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold text-ink">{value}</span>
        {unit && <span className="text-xs text-ink-subtle">{unit}</span>}
      </div>
    </div>
  );
}

function Step({
  n,
  done,
  href,
  children,
}: {
  n: number;
  done?: boolean;
  href?: string;
  children: React.ReactNode;
}) {
  const marker = (
    <span
      className={[
        "grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px]",
        done ? "bg-success/20 text-success" : "bg-white/5 text-ink-muted",
      ].join(" ")}
    >
      {done ? "✓" : n}
    </span>
  );

  const labelClass = done
    ? "text-ink-muted line-through"
    : "text-ink-muted";

  if (href && !done) {
    return (
      <li>
        <Link
          href={href}
          className="group flex items-center gap-3 rounded-lg p-2 transition hover:bg-white/5"
        >
          {marker}
          <span className="flex-1 text-ink group-hover:text-cyan">
            {children}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-ink-subtle group-hover:text-cyan"
            aria-hidden
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 p-2">
      {marker}
      <span className={`flex-1 ${labelClass}`}>{children}</span>
    </li>
  );
}
