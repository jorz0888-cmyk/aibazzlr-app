import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { syncSubscriptionToProfile } from "@/lib/billing/sync";

export const runtime = "nodejs";
// Stripe signs raw body — disable Next's built-in body parsing assumptions.
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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
          await syncSubscriptionToProfile(subscription, userId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionToProfile(subscription, null);
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
          await syncSubscriptionToProfile(subscription, null);
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
