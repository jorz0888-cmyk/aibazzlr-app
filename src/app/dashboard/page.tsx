import { createClient } from "@/lib/supabase/server";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── DASHBOARD
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          ようこそ、
          <span className="text-cyan">{user?.email}</span> さん 👋
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          AIBazzlrへようこそ。SNS連携と投稿設定はまもなく利用可能になります。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="連携済みSNS" value="0" hint="Phase 3で実装" />
        <Card label="今月のAI投稿" value="0" hint="Phase 3で実装" />
        <Card label="ご利用プラン" value="Free" hint="アップグレードはまもなく" />
      </div>

      <div className="card p-6">
        <h2 className="text-base font-bold text-ink">次のステップ</h2>
        <ol className="mt-4 space-y-3 text-sm text-ink-muted">
          <Step n={1} done>
            アカウント作成
          </Step>
          <Step n={2}>SNSアカウントを連携する（Coming Soon）</Step>
          <Step n={3}>ブランド情報を設定する（Coming Soon）</Step>
          <Step n={4}>AIに自動投稿を任せる（Coming Soon）</Step>
        </ol>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="card p-5">
      <div className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
        {label.toUpperCase()}
      </div>
      <div className="mt-2 text-3xl font-extrabold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-subtle">{hint}</div>
    </div>
  );
}

function Step({
  n,
  done,
  children,
}: {
  n: number;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={[
          "grid h-6 w-6 place-items-center rounded-full font-mono text-[11px]",
          done
            ? "bg-success/20 text-success"
            : "bg-white/5 text-ink-muted",
        ].join(" ")}
      >
        {done ? "✓" : n}
      </span>
      <span className={done ? "text-ink line-through opacity-70" : ""}>
        {children}
      </span>
    </li>
  );
}
