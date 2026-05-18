import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { planFromPriceId, getCurrentPeriod } from "@/lib/stripe";
import type { Plan, SubscriptionStatus } from "@/lib/supabase/types";

type ProfileUpdate = {
  plan?: Plan;
  subscription_id?: string | null;
  subscription_status?: SubscriptionStatus | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  canceled_at?: string | null;
  stripe_customer_id?: string;
};

const KNOWN_STATUSES: ReadonlyArray<SubscriptionStatus> = [
  "active",
  "canceled",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "trialing",
];

function isKnownStatus(s: string): s is SubscriptionStatus {
  return (KNOWN_STATUSES as ReadonlyArray<string>).includes(s);
}

/**
 * Write the canonical fields derived from a Stripe Subscription onto the
 * matching `profiles` row. Called from BOTH the webhook handler and from
 * the in-app change-subscription route — the second caller writes the
 * same data immediately so the post-redirect page render reflects the new
 * plan without waiting for the webhook to land (which can be 1-3s later).
 *
 * Idempotent: when the webhook fires later it just writes the same values.
 *
 * Match strategy: look up by `subscription_id` first (covers the common
 * update case), then fall back to `fallbackUserId` or the subscription's
 * `metadata.user_id` (covers the very first checkout completion before
 * `subscription_id` has been persisted).
 */
export async function syncSubscriptionToProfile(
  subscription: Stripe.Subscription,
  fallbackUserId: string | null,
): Promise<void> {
  const admin = createAdminClient();

  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const plan: Plan = planFromPriceId(priceId) ?? "free";
  const { start, end } = getCurrentPeriod(subscription);
  const status: SubscriptionStatus | null = isKnownStatus(subscription.status)
    ? subscription.status
    : null;

  const update: ProfileUpdate = {
    plan,
    subscription_id: subscription.id,
    subscription_status: status,
    current_period_start: start ? start.toISOString() : null,
    current_period_end: end ? end.toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
  };

  const { data: bySub, error: bySubErr } = await admin
    .from("profiles")
    .update(update)
    .eq("subscription_id", subscription.id)
    .select("id");
  if (bySubErr) {
    console.error("[billing/sync] update by subscription_id failed", bySubErr);
  }
  if (bySub && bySub.length > 0) return;

  const userId =
    fallbackUserId ??
    (typeof subscription.metadata?.user_id === "string"
      ? subscription.metadata.user_id
      : null);
  if (!userId) {
    console.warn("[billing/sync] no user_id available to apply subscription", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) {
    console.error("[billing/sync] update by user_id failed", error);
  }
}
