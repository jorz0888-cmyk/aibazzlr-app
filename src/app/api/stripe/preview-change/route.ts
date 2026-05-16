import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import {
  stripe,
  STRIPE_PRICE_IDS,
  comparePlans,
  type PaidPlan,
} from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Preview what a plan change would cost the user *right now* and on the
 * next regular invoice. Used by the confirmation modal so the upgrade /
 * downgrade screen can show concrete numbers instead of vague "差額分".
 *
 * Returns `immediate_charge` (yen, integer) — what hits the card today
 * for an upgrade (zero for a downgrade since we credit to next invoice),
 * `next_invoice_total`, and `direction` so the client can pick the right
 * copy.
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
    .select("subscription_id, stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.subscription_id || !profile?.stripe_customer_id) {
    return NextResponse.json(
      { error: "アクティブなサブスクリプションがありません" },
      { status: 400 },
    );
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(
      profile.subscription_id,
    );
    const itemId = subscription.items.data[0]?.id;
    const currentPriceId = subscription.items.data[0]?.price?.id ?? null;
    if (!itemId) {
      return NextResponse.json(
        { error: "サブスクリプション項目が取得できませんでした" },
        { status: 500 },
      );
    }

    const direction = comparePlans(currentPriceId, targetPrice);
    const proration: "always_invoice" | "create_prorations" =
      direction === "upgrade" ? "always_invoice" : "create_prorations";

    // SDK 22's InvoiceCreatePreviewParams has a fairly involved generic shape;
    // cast the body to avoid recapitulating it field-by-field for what is
    // essentially a simple call.
    const preview = (await stripe.invoices.createPreview({
      customer: profile.stripe_customer_id,
      subscription: profile.subscription_id,
      subscription_details: {
        items: [{ id: itemId, price: targetPrice }],
        proration_behavior: proration,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Stripe.Invoice;

    return NextResponse.json({
      direction, // "upgrade" | "downgrade" | "same"
      currency: preview.currency,
      // For always_invoice this is the amount to charge today; for
      // create_prorations the invoice is the *next* regular invoice with
      // the proration credit baked in, so immediate_charge is 0.
      immediate_charge: direction === "upgrade" ? (preview.amount_due ?? 0) : 0,
      next_invoice_total: preview.total ?? 0,
      next_invoice_subtotal: preview.subtotal ?? 0,
    });
  } catch (e) {
    console.error("[stripe/preview-change] failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `プレビュー取得に失敗しました: ${e.message}`
            : "プレビュー取得に失敗しました",
      },
      { status: 502 },
    );
  }
}
