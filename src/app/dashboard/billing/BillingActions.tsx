"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import type { Plan } from "@/lib/plans";

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
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPaidToPaidSwitch =
    currentPlan === "standard" || currentPlan === "premium";
  const isDowngrade =
    currentPlan === "premium" && plan === "standard";

  async function go() {
    setErr(null);
    setLoading(true);
    try {
      const endpoint = isPaidToPaidSwitch
        ? "/api/stripe/change-subscription"
        : "/api/stripe/create-checkout-session";
      const { url } = await postJson<{ url: string }>(endpoint, { plan });
      if (!url) throw new Error("URL was not returned");
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラーが発生しました");
      setLoading(false);
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
        onClick={go}
        disabled={loading}
      >
        {loading ? <Spinner /> : label}
      </button>
      {isPaidToPaidSwitch && (
        <p className="text-[11px] text-ink-subtle">
          既存サブスクリプションを差額計算（日割り）で切り替えます。
        </p>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
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
