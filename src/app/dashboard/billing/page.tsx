import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  PLAN_DISPLAY_NAMES,
  PLAN_FEATURES,
  PLAN_PRICES,
  type Plan,
} from "@/lib/plans";
import {
  checkMonthlyPostQuota,
  checkAiConfigQuota,
  checkMonthlyImageQuota,
} from "@/lib/quota";
import {
  BillingActions,
  DowngradeToFreeButton,
  UpgradeButton,
} from "./BillingActions";

export const dynamic = "force-dynamic";

const PLANS: Plan[] = ["free", "standard", "premium"];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    canceled?: string;
    upgraded?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "plan, subscription_status, current_period_end, cancel_at_period_end",
    )
    .eq("id", user.id)
    .single();

  const currentPlan = (profile?.plan ?? "free") as Plan;
  const subscriptionStatus = profile?.subscription_status ?? null;
  const periodEnd = profile?.current_period_end ?? null;
  const cancelAtPeriodEnd = profile?.cancel_at_period_end ?? false;

  const [postQuota, configQuota, imageQuota] = await Promise.all([
    checkMonthlyPostQuota(user.id),
    checkAiConfigQuota(user.id),
    checkMonthlyImageQuota(user.id),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── BILLING
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          プラン・お支払い
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          現在のプランと使用量を確認し、必要に応じてアップグレードできます。
        </p>
      </div>

      {params.success === "true" && (
        <div className="card border-success/40 bg-success/10 p-4 text-sm text-success">
          ご契約ありがとうございます。プランの反映には数秒かかる場合があります。
          数分待っても反映されない場合はページを再読み込みしてください。
        </div>
      )}
      {params.canceled === "true" && (
        <div className="card border-line-strong bg-white/5 p-4 text-sm text-ink-muted">
          チェックアウトをキャンセルしました。
        </div>
      )}
      {params.upgraded === "true" && (
        <div className="card border-success/40 bg-success/10 p-4 text-sm text-success">
          プランを変更しました。差額は日割りで計算され、次回請求に反映されます。
          反映には数秒かかる場合があります。
        </div>
      )}

      <section className="card p-6">
        <h2 className="text-base font-bold text-ink">現在の状況</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
              CURRENT PLAN
            </dt>
            <dd className="mt-1 text-xl font-extrabold text-ink">
              {PLAN_DISPLAY_NAMES[currentPlan]}
            </dd>
            <dd className="text-xs text-ink-subtle">
              {PLAN_PRICES[currentPlan].display}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
              POSTS THIS PERIOD
            </dt>
            <dd className="mt-1 text-xl font-extrabold text-ink">
              {postQuota.used} <span className="text-sm text-ink-subtle">/ {postQuota.limit}</span>
            </dd>
            <Bar value={postQuota.used} max={postQuota.limit} />
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
              AI IMAGES THIS PERIOD
            </dt>
            <dd className="mt-1 text-xl font-extrabold text-ink">
              {imageQuota.used}{" "}
              <span className="text-sm text-ink-subtle">
                / {imageQuota.limit > 0 ? imageQuota.limit : "—"}
              </span>
            </dd>
            {imageQuota.limit > 0 ? (
              <Bar value={imageQuota.used} max={imageQuota.limit} />
            ) : (
              <p className="mt-1 text-[11px] text-ink-subtle">
                ※ AI画像生成は Standard 以上で利用可能
              </p>
            )}
          </div>
          <div>
            <dt className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
              AI CONFIGS
            </dt>
            <dd className="mt-1 text-xl font-extrabold text-ink">
              {configQuota.current}{" "}
              <span className="text-sm text-ink-subtle">
                / {configQuota.limit >= 999 ? "∞" : configQuota.limit}
              </span>
            </dd>
            <Bar
              value={configQuota.current}
              max={Math.min(configQuota.limit, 50)}
            />
          </div>
        </dl>

        {subscriptionStatus && currentPlan !== "free" && (
          <p className="mt-4 text-xs text-ink-muted">
            {cancelAtPeriodEnd ? (
              <>
                解約予定。
                {periodEnd
                  ? ` ${formatDate(periodEnd)} までご利用いただけます。`
                  : null}
              </>
            ) : (
              <>
                次回更新日: {periodEnd ? formatDate(periodEnd) : "—"} ・ ステータス: {subscriptionStatus}
              </>
            )}
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            current={currentPlan === plan}
            currentPlan={currentPlan}
            cancelAtPeriodEnd={cancelAtPeriodEnd}
          />
        ))}
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-bold text-ink">サブスクリプションの管理</h2>
        <p className="mt-1 text-xs text-ink-muted">
          支払い方法の変更、領収書の取得、解約は Stripe カスタマーポータルから行えます。
        </p>
        <BillingActions
          currentPlan={currentPlan}
          subscriptionStatus={subscriptionStatus}
        />
      </section>

      <p className="text-[11px] leading-relaxed text-ink-subtle">
        試用期間はありません（Free プランで永久にご利用可能）。
        解約はいつでも可能で、当該期間の末日までご利用いただけます。返金はありません。
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  currentPlan,
  cancelAtPeriodEnd,
}: {
  plan: Plan;
  current: boolean;
  currentPlan: Plan;
  cancelAtPeriodEnd: boolean;
}) {
  return (
    <article
      className={[
        "card flex flex-col p-6",
        current ? "border-cyan/60 bg-cyan/5" : "",
      ].join(" ")}
    >
      <header>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-extrabold text-ink">
            {PLAN_DISPLAY_NAMES[plan]}
          </h3>
          {current && (
            <span className="rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] tracking-wider text-cyan">
              CURRENT
            </span>
          )}
          {current && cancelAtPeriodEnd && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[10px] tracking-wider text-warning">
              CANCELING
            </span>
          )}
        </div>
        <p className="mt-1 text-xl font-extrabold text-ink">
          {PLAN_PRICES[plan].display}
        </p>
      </header>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-muted">
        {PLAN_FEATURES[plan].map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 text-cyan">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <PlanCta plan={plan} current={current} currentPlan={currentPlan} />
      </div>
    </article>
  );
}

function PlanCta({
  plan,
  current,
  currentPlan,
}: {
  plan: Plan;
  current: boolean;
  currentPlan: Plan;
}) {
  if (current) {
    return (
      <button type="button" className="btn-secondary w-full" disabled>
        現在のプラン
      </button>
    );
  }
  if (plan === "free") {
    return <DowngradeToFreeButton />;
  }
  return <UpgradeButton plan={plan} currentPlan={currentPlan} />;
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const danger = pct >= 90;
  const warn = pct >= 75 && !danger;
  const color = danger ? "bg-danger" : warn ? "bg-warning" : "bg-cyan";
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
