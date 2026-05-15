import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe, siteUrl } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json(
      { error: "サブスクリプションが見つかりません" },
      { status: 400 },
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl()}/dashboard/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/portal] session create failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `Portalセッションの作成に失敗しました: ${e.message}`
            : "Portalセッションの作成に失敗しました",
      },
      { status: 502 },
    );
  }
}
