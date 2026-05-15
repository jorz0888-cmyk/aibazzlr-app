import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Lazy Stripe client. Throws only when actually used at request time, not at
 * module-load — Next.js evaluates route modules during `next build`, before
 * runtime env vars are wired in.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { typescript: true });
  }
  return _stripe;
}

/** Back-compat: `stripe` proxy so existing call sites keep working. */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export const STRIPE_PRICE_IDS = {
  standard: process.env.STRIPE_PRICE_ID_STANDARD ?? "",
  premium: process.env.STRIPE_PRICE_ID_PREMIUM ?? "",
} as const;

export type PaidPlan = keyof typeof STRIPE_PRICE_IDS;

export function planFromPriceId(
  priceId: string | null | undefined,
): "standard" | "premium" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_STANDARD) return "standard";
  if (priceId === process.env.STRIPE_PRICE_ID_PREMIUM) return "premium";
  return null;
}

/**
 * In Stripe API 2025+ / SDK 22+, the billing-cycle anchor fields
 * (`current_period_start`, `current_period_end`) live on the subscription
 * *items*, not on the subscription itself. Pull them from the first item.
 */
export function getCurrentPeriod(subscription: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const item = subscription.items?.data?.[0];
  const start =
    item?.current_period_start != null
      ? new Date(item.current_period_start * 1000)
      : null;
  const end =
    item?.current_period_end != null
      ? new Date(item.current_period_end * 1000)
      : null;
  return { start, end };
}

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "https://app.aibazzlr.com"
  );
}
