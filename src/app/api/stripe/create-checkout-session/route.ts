import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe, STRIPE_PRICE_IDS, siteUrl } from "@/lib/stripe";
import type { PaidPlan } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    plan?: string;
  };
  const plan = body.plan as PaidPlan;
  if (plan !== "standard" && plan !== "premium") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const priceId = STRIPE_PRICE_IDS[plan];
  if (!priceId) {
    return NextResponse.json(
      { error: "Stripe price ID is not configured" },
      { status: 500 },
    );
  }

  // Fetch or create the Stripe customer for this profile.
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    } catch (e) {
      console.error("[stripe/checkout] customer create failed", e);
      return NextResponse.json(
        { error: "Stripe顧客の作成に失敗しました" },
        { status: 502 },
      );
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl()}/dashboard/billing?success=true`,
      cancel_url: `${siteUrl()}/dashboard/billing?canceled=true`,
      allow_promotion_codes: true,
      metadata: { user_id: user.id, plan },
      subscription_data: {
        metadata: { user_id: user.id, plan },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/checkout] session create failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `Checkoutセッションの作成に失敗しました: ${e.message}`
            : "Checkoutセッションの作成に失敗しました",
      },
      { status: 502 },
    );
  }
}
