import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  stripe,
  STRIPE_PRICE_IDS,
  siteUrl,
  comparePlans,
  type PaidPlan,
} from "@/lib/stripe";
import { syncSubscriptionToProfile } from "@/lib/billing/sync";

export const runtime = "nodejs";

/**
 * Change the plan of an EXISTING paid subscription (Standard <-> Premium).
 *
 * Why a separate route from /create-checkout-session: Checkout always spins
 * up a brand-new subscription, leaving the old one billing in parallel.
 * For paid→paid switches we must update the existing subscription in place
 * with proration so the user is only ever on one subscription at a time.
 *
 * Free → paid is still handled by /create-checkout-session.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  const plan = body.plan as PaidPlan;
  if (plan !== "standard" && plan !== "premium") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const targetPrice = STRIPE_PRICE_IDS[plan];
  if (!targetPrice) {
    return NextResponse.json(
      { error: "Stripe price ID is not configured" },
      { status: 500 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_id, subscription_status, plan")
    .eq("id", user.id)
    .single();

  if (!profile?.subscription_id) {
    return NextResponse.json(
      {
        error:
          "アクティブなサブスクリプションがありません。チェックアウトから契約してください。",
      },
      { status: 400 },
    );
  }

  // Don't run an update when nothing would change.
  if (profile.plan === plan) {
    return NextResponse.json({ url: `${siteUrl()}/dashboard/billing` });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      profile.subscription_id,
    );

    // Subscriptions that are fully terminated cannot be updated — fall back
    // to creating a new Checkout session via /create-checkout-session.
    if (
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired"
    ) {
      return NextResponse.json(
        {
          error:
            "サブスクリプションが終了しています。アップグレードボタンから再契約してください。",
          fallback: "checkout",
        },
        { status: 409 },
      );
    }

    const itemId = subscription.items.data[0]?.id;
    const currentPriceId = subscription.items.data[0]?.price?.id ?? null;
    if (!itemId) {
      return NextResponse.json(
        { error: "サブスクリプション項目が取得できませんでした" },
        { status: 500 },
      );
    }

    // Phase 9.1: charge upgrades immediately so the user sees the prorated
    // amount on the same card transaction. Downgrades stay on
    // `create_prorations` so the unused portion of the higher plan becomes
    // a credit applied to the next regular invoice — industry standard,
    // avoids triggering a refund-to-card flow.
    const direction = comparePlans(currentPriceId, targetPrice);
    const prorationBehavior: "always_invoice" | "create_prorations" =
      direction === "upgrade" ? "always_invoice" : "create_prorations";

    const updated = await stripe.subscriptions.update(profile.subscription_id, {
      items: [{ id: itemId, price: targetPrice }],
      proration_behavior: prorationBehavior,
      // Re-activate if the user had scheduled a cancellation; otherwise leave
      // the flag alone (cancel_at_period_end defaults to its existing value).
      cancel_at_period_end: false,
      metadata: { user_id: user.id, plan },
    });

    // Sync the profile row inline before redirecting. Without this, the
    // page reload races the customer.subscription.updated webhook (~1-3s),
    // and the user sees their old plan on the billing page after the
    // redirect. Idempotent with the webhook: when it lands later it writes
    // the same fields.
    try {
      await syncSubscriptionToProfile(updated, user.id);
    } catch (syncErr) {
      // Don't block the response on sync failure — the webhook is still
      // the source of truth and will reconcile.
      console.error("[stripe/change-subscription] inline sync failed", syncErr);
    }

    return NextResponse.json({
      url: `${siteUrl()}/dashboard/billing?upgraded=true`,
    });
  } catch (e) {
    console.error("[stripe/change-subscription] update failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `プラン変更に失敗しました: ${e.message}`
            : "プラン変更に失敗しました",
      },
      { status: 502 },
    );
  }
}
