/**
 * Phase 9: plan catalog — limits, pricing, display names.
 * The DB enum is `free | standard | premium` (see migration phase9_add_billing).
 */
export type Plan = "free" | "standard" | "premium";

export const PLAN_LIMITS = {
  free: {
    posts_per_month: 10,
    ai_configs_max: 1,
    social_accounts_max: 1,
    hearings_per_day: 1,
    test_posts_per_day: 5,
    ai_images_per_month: 0, // Free users can upload, but cannot generate
  },
  standard: {
    posts_per_month: 150,
    ai_configs_max: 3,
    social_accounts_max: 1,
    hearings_per_day: 3,
    test_posts_per_day: 10,
    ai_images_per_month: 30,
  },
  premium: {
    posts_per_month: 450,
    ai_configs_max: 999, // effectively unlimited
    social_accounts_max: 1,
    hearings_per_day: 10,
    test_posts_per_day: 20,
    ai_images_per_month: 100,
  },
} as const;

export const PLAN_PRICES = {
  free: { display: "無料", amount: 0 },
  standard: { display: "2,980円/月（税込）", amount: 2980 },
  premium: { display: "5,980円/月（税込）", amount: 5980 },
} as const;

export const PLAN_DISPLAY_NAMES = {
  free: "Free",
  standard: "Standard",
  premium: "Premium",
} as const;

export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    "月10投稿まで",
    "AI設定 1つまで",
    "X アカウント 1つ連携",
    "クレカ登録不要",
  ],
  standard: [
    "月150投稿まで（1日5投稿目安）",
    "AI設定 3つまで",
    "X アカウント 1つ連携",
    "全機能利用可能",
  ],
  premium: [
    "月450投稿まで（1日15投稿目安）",
    "AI設定 無制限",
    "X アカウント 1つ連携",
    "全機能 + 早期アクセス",
  ],
};

export function getPlanLimits(plan: Plan) {
  return PLAN_LIMITS[plan];
}

export function getPlanPrice(plan: Plan) {
  return PLAN_PRICES[plan];
}

export function isPaidPlan(plan: Plan): plan is "standard" | "premium" {
  return plan === "standard" || plan === "premium";
}
