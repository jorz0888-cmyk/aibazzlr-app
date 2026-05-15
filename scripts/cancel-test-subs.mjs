// One-shot script: find the Stripe customer for a given email and
// IMMEDIATELY cancel every non-terminal subscription. Test mode only.
// Run with: `node --env-file=.env.local scripts/cancel-test-subs.mjs <email>`
import Stripe from "stripe";

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error("usage: node scripts/cancel-test-subs.mjs <email>");
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set");
  process.exit(1);
}
if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) {
  console.error("Refusing to run against a non-test key:", key.slice(0, 8));
  process.exit(1);
}

const stripe = new Stripe(key);

const TERMINAL = new Set(["canceled", "incomplete_expired"]);

async function main() {
  const customers = await stripe.customers.list({ email: EMAIL, limit: 10 });
  console.log(`Found ${customers.data.length} customer(s) for ${EMAIL}`);

  for (const c of customers.data) {
    console.log(`\nCustomer ${c.id} (${c.email})`);
    const subs = await stripe.subscriptions.list({
      customer: c.id,
      status: "all",
      limit: 100,
    });
    console.log(`  ${subs.data.length} subscription(s)`);

    for (const s of subs.data) {
      const priceId = s.items?.data?.[0]?.price?.id ?? "?";
      console.log(
        `   - ${s.id} status=${s.status} price=${priceId} cancel_at_period_end=${s.cancel_at_period_end}`,
      );
      if (TERMINAL.has(s.status)) {
        console.log(`     skip (already terminal)`);
        continue;
      }
      try {
        const canceled = await stripe.subscriptions.cancel(s.id);
        console.log(
          `     ✓ canceled — new status=${canceled.status} canceled_at=${canceled.canceled_at}`,
        );
      } catch (e) {
        console.error(`     ✗ cancel failed:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("script crashed:", e);
  process.exit(1);
});
