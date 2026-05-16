"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { PLAN_DISPLAY_NAMES, PLAN_PRICES, type Plan } from "@/lib/plans";

type PreviewResponse = {
  direction: "upgrade" | "downgrade" | "same";
  currency: string;
  immediate_charge: number;
  next_invoice_total: number;
  next_invoice_subtotal: number;
};

function formatJpy(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export function UpgradeButton({
  plan,
  currentPlan,
}: {
  plan: Plan;
  /**
   * The user's current plan. When set to a paid plan we update the existing
   * Stripe subscription in place (proration) instead of opening Checkout —
   * otherwise the user would end up with two active subscriptions billing
   * in parallel.
   */
  currentPlan: Plan;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | null
    | { state: "loading" }
    | { state: "ready"; preview: PreviewResponse }
    | { state: "error"; message: string }
  >(null);

  const isPaidToPaidSwitch =
    currentPlan === "standard" || currentPlan === "premium";
  const isDowngrade =
    currentPlan === "premium" && plan === "standard";

  async function openConfirm() {
    setErr(null);
    // Free → paid keeps the Checkout flow with no preview modal (Stripe's
    // own Checkout page handles confirmation + payment in one place).
    if (!isPaidToPaidSwitch) {
      setSubmitting(true);
      try {
        const { url } = await postJson<{ url: string }>(
          "/api/stripe/create-checkout-session",
          { plan },
        );
        if (!url) throw new Error("URL was not returned");
        window.location.href = url;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "エラーが発生しました");
        setSubmitting(false);
      }
      return;
    }

    setConfirm({ state: "loading" });
    try {
      const preview = await postJson<PreviewResponse>(
        "/api/stripe/preview-change",
        { plan },
      );
      setConfirm({ state: "ready", preview });
    } catch (e) {
      setConfirm({
        state: "error",
        message: e instanceof Error ? e.message : "エラーが発生しました",
      });
    }
  }

  async function executeChange() {
    setSubmitting(true);
    setErr(null);
    try {
      const { url } = await postJson<{ url: string }>(
        "/api/stripe/change-subscription",
        { plan },
      );
      if (!url) throw new Error("URL was not returned");
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラーが発生しました");
      setSubmitting(false);
      setConfirm(null);
    }
  }

  const label = isPaidToPaidSwitch
    ? isDowngrade
      ? "このプランに変更（ダウングレード）"
      : "このプランにアップグレード"
    : "このプランにアップグレード";

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-primary w-full"
        onClick={openConfirm}
        disabled={submitting || confirm?.state === "loading"}
      >
        {submitting ? <Spinner /> : label}
      </button>
      {isPaidToPaidSwitch && (
        <p className="text-[11px] text-ink-subtle">
          {isDowngrade
            ? "残期間分のクレジットを次回請求から差し引きます。"
            : "差額を本日カードに即時請求します。"}
        </p>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}

      {confirm && (
        <ChangePlanConfirm
          plan={plan}
          currentPlan={currentPlan}
          isDowngrade={isDowngrade}
          state={confirm}
          submitting={submitting}
          onConfirm={executeChange}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ChangePlanConfirm({
  plan,
  currentPlan,
  isDowngrade,
  state,
  submitting,
  onConfirm,
  onCancel,
}: {
  plan: Plan;
  currentPlan: Plan;
  isDowngrade: boolean;
  state:
    | { state: "loading" }
    | { state: "ready"; preview: PreviewResponse }
    | { state: "error"; message: string };
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const targetMonthly = PLAN_PRICES[plan].amount;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur sm:p-6"
      onClick={submitting ? undefined : onCancel}
    >
      <div
        className="card w-full max-w-md overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-line p-5">
          <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
            ── {isDowngrade ? "DOWNGRADE" : "UPGRADE"}
          </p>
          <h3 className="mt-1 text-lg font-bold text-ink">
            {PLAN_DISPLAY_NAMES[plan]} プランに
            {isDowngrade ? "ダウングレード" : "アップグレード"}
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            {PLAN_DISPLAY_NAMES[currentPlan]} から {PLAN_DISPLAY_NAMES[plan]} へ切り替えます。
          </p>
        </header>

        <div className="space-y-4 p-5 text-sm">
          {state.state === "loading" && (
            <div className="grid place-items-center py-6">
              <Spinner />
              <p className="mt-2 text-xs text-ink-subtle">
                請求額を計算しています...
              </p>
            </div>
          )}

          {state.state === "error" && (
            <div className="err">{state.message}</div>
          )}

          {state.state === "ready" && (
            <>
              {isDowngrade ? (
                <>
                  <Row
                    label="本日の請求"
                    value="なし"
                    note="ダウングレード分は次回請求から自動的に差し引かれます"
                  />
                  <Row
                    label="残期間クレジット"
                    value={formatJpy(
                      Math.max(
                        0,
                        targetMonthly - (state.preview.next_invoice_total ?? 0),
                      ),
                    )}
                    note="次回請求から差し引かれる金額の目安"
                  />
                </>
              ) : (
                <Row
                  label="本日の即時請求"
                  value={formatJpy(state.preview.immediate_charge ?? 0)}
                  note="現在の期間の残日数に応じて自動計算された差額です"
                  emphasis
                />
              )}

              <div className="border-t border-line pt-3">
                <Row
                  label={`次回請求（${PLAN_DISPLAY_NAMES[plan]} 通常料金）`}
                  value={formatJpy(targetMonthly)}
                  note="以降は毎月この金額が請求されます"
                />
              </div>

              <p className="rounded-md bg-white/5 p-3 text-[11px] text-ink-subtle">
                ご登録のカードに{isDowngrade ? "次回請求時に" : "本日"}決済が走ります。
                税込価格表示・領収書は Stripe より発行されます。
              </p>
            </>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={submitting || state.state !== "ready"}
          >
            {submitting ? (
              <Spinner />
            ) : isDowngrade ? (
              "ダウングレードする"
            ) : (
              "アップグレードする"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-ink">{label}</p>
        {note && <p className="mt-0.5 text-[11px] text-ink-subtle">{note}</p>}
      </div>
      <p
        className={[
          "shrink-0 font-mono",
          emphasis ? "text-base font-bold text-cyan" : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

function usePortal() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setErr(null);
    setLoading(true);
    try {
      const { url } = await postJson<{ url: string }>(
        "/api/stripe/create-portal-session",
      );
      if (!url) throw new Error("Portal URL was not returned");
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラーが発生しました");
      setLoading(false);
    }
  }

  return { loading, err, open };
}

export function BillingActions({
  currentPlan,
  subscriptionStatus,
}: {
  currentPlan: Plan;
  subscriptionStatus: string | null;
}) {
  const { loading, err, open } = usePortal();

  const hasSubscription =
    currentPlan !== "free" || subscriptionStatus === "canceled";

  if (!hasSubscription) {
    return (
      <p className="mt-3 text-xs text-ink-subtle">
        有料プラン契約後にカスタマーポータルが利用できるようになります。
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        className="btn-secondary"
        onClick={open}
        disabled={loading}
      >
        {loading ? <Spinner /> : "カスタマーポータルを開く"}
      </button>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

/**
 * "Downgrade to Free" CTA shown on the Free plan card when the user is on a
 * paid plan. Routes to the Stripe customer portal — Stripe's own cancel flow
 * handles confirmation, end-of-period scheduling, and the change-of-mind
 * reactivation path. Webhook reconciles `plan='free'` when the subscription
 * is fully canceled at period end.
 */
export function DowngradeToFreeButton() {
  const { loading, err, open } = usePortal();
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary w-full"
        onClick={open}
        disabled={loading}
      >
        {loading ? <Spinner /> : "カスタマーポータルで解約"}
      </button>
      <p className="text-[11px] text-ink-subtle">
        解約後も当該期間の末日まで現在のプランをご利用いただけます。
      </p>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
