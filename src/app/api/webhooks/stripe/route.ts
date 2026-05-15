import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  stripe,
  planFromPriceId,
  getCurrentPeriod,
} from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import type { Plan, SubscriptionStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";
// Stripe signs raw body — disable Next's built-in body parsing assumptions.
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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

function isKnownStatus(s: string): s is SubscriptionStatus {
  return [
    "active",
    "canceled",
    "past_due",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "trialing",
  ].includes(s);
}

async function applySubscriptionToProfile(
  subscription: Stripe.Subscription,
  fallbackUserId: string | null,
) {
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

  // Try by subscription_id first, then fall back to metadata user_id (covers
  // the very first checkout when subscription_id hasn't been stored yet).
  const { data: bySub, error: bySubErr } = await admin
    .from("profiles")
    .update(update)
    .eq("subscription_id", subscription.id)
    .select("id");
  if (bySubErr) {
    console.error("[stripe/webhook] update by subscription_id failed", bySubErr);
  }
  if (bySub && bySub.length > 0) return;

  const userId =
    fallbackUserId ??
    (typeof subscription.metadata?.user_id === "string"
      ? subscription.metadata.user_id
      : null);
  if (!userId) {
    console.warn(
      "[stripe/webhook] no user_id available to apply subscription",
      { subscriptionId: subscription.id },
    );
    return;
  }

  const { error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", userId);
  if (error) {
    console.error("[stripe/webhook] update by user_id failed", error);
  }
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (e) {
    console.error("[stripe/webhook] signature verification failed", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          typeof session.metadata?.user_id === "string"
            ? session.metadata.user_id
            : null;

        // Pull the subscription with items expanded so we get period info.
        if (typeof session.subscription === "string") {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription,
            { expand: ["items.data.price"] },
          );
          await applySubscriptionToProfile(subscription, userId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await applySubscriptionToProfile(subscription, null);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const admin = createAdminClient();
        await admin
          .from("profiles")
          .update({
            plan: "free",
            subscription_status: "canceled",
            cancel_at_period_end: false,
            canceled_at:
              (subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000)
                : new Date()
              ).toISOString(),
          })
          .eq("subscription_id", subscription.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        // Some invoices carry a parent subscription reference; if so, refresh
        // billing period from the live subscription.
        const subId =
          // Cast to read potentially-missing field across SDK versions.
          (invoice as unknown as { subscription?: string | Stripe.Subscription })
            .subscription;
        if (typeof subId === "string") {
          const subscription = await stripe.subscriptions.retrieve(subId, {
            expand: ["items.data.price"],
          });
          await applySubscriptionToProfile(subscription, null);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          (invoice as unknown as { subscription?: string | Stripe.Subscription })
            .subscription;
        if (typeof subId === "string") {
          const admin = createAdminClient();
          await admin
            .from("profiles")
            .update({ subscription_status: "past_due" })
            .eq("subscription_id", subId);
        }
        break;
      }

      default:
        // Ignore unrelated events to keep the surface tiny.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[stripe/webhook] handler error", {
      type: event.type,
      error: e instanceof Error ? e.message : e,
    });
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}
