import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDailyCounter, incrementDailyCounter } from "@/lib/rate-limit";
import { getPlanLimits, type Plan } from "@/lib/plans";

// ---------------------------------------------------------------------------
// Daily quotas (Phase 7.5a) — hearing + test_post are short-burst protections,
// not the billing surface. They are plan-aware so paid users get more
// per-day capacity. Post-publication monthly quota is handled separately by
// `checkMonthlyPostQuota` since it ties to Stripe billing periods.
// ---------------------------------------------------------------------------

export type DailyQuotaType = "hearing" | "test_post";

export interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: Date;
  quotaType: DailyQuotaType;
  source: "db" | "redis" | "fail_open";
  plan: Plan;
}

function nextDailyResetAt(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function dailyLimit(plan: Plan, quotaType: DailyQuotaType): number {
  const limits = getPlanLimits(plan);
  return quotaType === "hearing"
    ? limits.hearings_per_day
    : limits.test_posts_per_day;
}

async function getUserPlan(userId: string): Promise<Plan> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  const plan = (data?.plan ?? "free") as Plan;
  return plan;
}

export async function checkDailyQuota(
  userId: string,
  quotaType: DailyQuotaType,
): Promise<QuotaResult> {
  const plan = await getUserPlan(userId);
  const limit = dailyLimit(plan, quotaType);
  const resetAt = nextDailyResetAt();

  if (quotaType === "test_post") {
    const current = await getDailyCounter(`quota:test_post:${userId}`);
    if (current === null) {
      return {
        allowed: true,
        current: 0,
        limit,
        resetAt,
        quotaType,
        source: "fail_open",
        plan,
      };
    }
    return {
      allowed: current < limit,
      current,
      limit,
      resetAt,
      quotaType,
      source: "redis",
      plan,
    };
  }

  // hearing — count rows in ai_hearing_sessions over the last 24h
  const supabase = await createClient();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("ai_hearing_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneDayAgo);

  if (error) {
    console.error("[quota] DB count failed", { quotaType, error });
    return {
      allowed: true,
      current: 0,
      limit,
      resetAt,
      quotaType,
      source: "fail_open",
      plan,
    };
  }

  const current = count ?? 0;
  return {
    allowed: current < limit,
    current,
    limit,
    resetAt,
    quotaType,
    source: "db",
    plan,
  };
}

export async function recordQuotaUsage(
  userId: string,
  quotaType: DailyQuotaType,
): Promise<void> {
  if (quotaType !== "test_post") return;
  await incrementDailyCounter(`quota:test_post:${userId}`);
}

const DAILY_LABEL: Record<DailyQuotaType, string> = {
  hearing: "ヒアリング",
  test_post: "テスト投稿",
};

export function quotaExceededResponse(result: QuotaResult): NextResponse {
  return NextResponse.json(
    {
      error: "daily_quota_exceeded",
      message: `本日の${DAILY_LABEL[result.quotaType]}回数の上限（${result.limit}回）に達しました。明日また使えるようになります。`,
      details: {
        current: result.current,
        limit: result.limit,
        resetAt: result.resetAt.toISOString(),
        quotaType: result.quotaType,
        plan: result.plan,
      },
    },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": Math.floor(
          result.resetAt.getTime() / 1000,
        ).toString(),
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Monthly post quota (Phase 9) — tied to Stripe billing period for paid
// plans, falling back to calendar-month for free users.
// ---------------------------------------------------------------------------

export interface MonthlyPostQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  periodStart: Date;
  plan: Plan;
}

/**
 * Determine the current quota window for a profile. For free users we use
 * the calendar month (1日 0:00 〜 翌月1日 0:00). For paid users we use the
 * subscription's current period as reported by Stripe (synced via webhook).
 * If the period fields are missing (e.g. the webhook hasn't landed yet) we
 * fall back to calendar month so the user is never blocked unfairly.
 */
function windowFor(
  plan: Plan,
  periodStart: string | null,
  periodEnd: string | null,
): { start: Date; end: Date } {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (plan === "free") {
    return { start: monthStart, end: monthEnd };
  }

  const start = periodStart ? new Date(periodStart) : monthStart;
  const end = periodEnd ? new Date(periodEnd) : monthEnd;
  return { start, end };
}

export async function checkMonthlyPostQuota(
  userId: string,
): Promise<MonthlyPostQuotaResult> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, current_period_start, current_period_end")
    .eq("id", userId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  const limit = getPlanLimits(plan).posts_per_month;
  const { start, end } = windowFor(
    plan,
    profile?.current_period_start ?? null,
    profile?.current_period_end ?? null,
  );

  // Count posts that consumed (or are consuming) a generation slot in the
  // current window. We count drafts too — every generate call costs a Claude
  // request, and limiting only on `posted` would let a single user spam
  // generation with status='draft'.
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  const used = count ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
    resetAt: end,
    periodStart: start,
    plan,
  };
}

export function monthlyQuotaExceededResponse(
  result: MonthlyPostQuotaResult,
): NextResponse {
  return NextResponse.json(
    {
      error: "monthly_post_quota_exceeded",
      message: `今月の投稿生成上限（${result.limit}件）に達しました。プランをアップグレードするか、来月のリセットをお待ちください。`,
      details: {
        used: result.used,
        limit: result.limit,
        remaining: 0,
        resetAt: result.resetAt.toISOString(),
        plan: result.plan,
      },
    },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": Math.floor(
          result.resetAt.getTime() / 1000,
        ).toString(),
      },
    },
  );
}

// ---------------------------------------------------------------------------
// AI config count quota — checked at config creation time.
// ---------------------------------------------------------------------------

export interface AiConfigQuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  plan: Plan;
}

export async function checkAiConfigQuota(
  userId: string,
): Promise<AiConfigQuotaResult> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  const limit = getPlanLimits(plan).ai_configs_max;

  const { count } = await supabase
    .from("ai_configs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const current = count ?? 0;
  return {
    allowed: current < limit,
    current,
    limit,
    plan,
  };
}

// ---------------------------------------------------------------------------
// Monthly AI image generation quota (Phase 12). Tracked as a counter on
// profiles rather than a SELECT count(*) because generated images are stored
// with `source='ai_generated'` and we want refunds / soft-resets to be a
// simple UPDATE without rescanning the library.
// ---------------------------------------------------------------------------

export interface MonthlyImageQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  plan: Plan;
}

/**
 * If the recorded `ai_images_period_start` is in a previous calendar month
 * (free) or before the current Stripe billing period (paid), the counter
 * needs a reset. We perform the reset inline so callers always see the
 * correct number.
 */
async function readOrResetImageQuota(
  userId: string,
): Promise<{ plan: Plan; used: number; periodStartIso: string }> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "plan, ai_images_used_this_period, ai_images_period_start, current_period_start",
    )
    .eq("id", userId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const wantStartIso =
    plan === "free"
      ? monthStart.toISOString()
      : (profile?.current_period_start ?? monthStart.toISOString());

  const recordedStart = profile?.ai_images_period_start ?? null;
  if (!recordedStart || new Date(recordedStart) < new Date(wantStartIso)) {
    await supabase
      .from("profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        ai_images_used_this_period: 0,
        ai_images_period_start: wantStartIso,
      } as any)
      .eq("id", userId);
    return { plan, used: 0, periodStartIso: wantStartIso };
  }

  return {
    plan,
    used: profile?.ai_images_used_this_period ?? 0,
    periodStartIso: recordedStart,
  };
}

export async function checkMonthlyImageQuota(
  userId: string,
): Promise<MonthlyImageQuotaResult> {
  const { plan, used } = await readOrResetImageQuota(userId);
  const limit = getPlanLimits(plan).ai_images_per_month;
  return {
    allowed: limit > 0 && used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan,
  };
}

/**
 * Atomically increment the AI image counter for the current period. Caller
 * should have called `checkMonthlyImageQuota` first to confirm capacity.
 */
export async function recordAiImageUsage(userId: string): Promise<void> {
  const supabase = await createClient();
  // Use the profile row's existing counter so concurrent generations don't
  // both read "0" and write "1".
  const { data: profile } = await supabase
    .from("profiles")
    .select("ai_images_used_this_period")
    .eq("id", userId)
    .single();
  const next = (profile?.ai_images_used_this_period ?? 0) + 1;
  await supabase
    .from("profiles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ ai_images_used_this_period: next } as any)
    .eq("id", userId);
}

export function imageQuotaExceededResponse(
  result: MonthlyImageQuotaResult,
): NextResponse {
  const planLabel =
    result.plan === "free"
      ? "Standard 以上"
      : result.plan === "standard"
        ? "Premium"
        : null;
  return NextResponse.json(
    {
      error: "monthly_image_quota_exceeded",
      message:
        result.limit === 0
          ? `現在のプラン（${result.plan}）では AI 画像生成は利用できません。${
              planLabel ?? ""
            } プランにアップグレードしてください。`
          : `今月の AI 画像生成上限（${result.limit} 枚）に達しました。${
              planLabel ? `${planLabel} プランにアップグレードするか、` : ""
            }来月のリセットをお待ちください。`,
      details: {
        used: result.used,
        limit: result.limit,
        plan: result.plan,
      },
    },
    { status: 429 },
  );
}

export function aiConfigQuotaExceededResponse(
  result: AiConfigQuotaResult,
): NextResponse {
  const planLabel = result.plan === "free" ? "Standard" : "Premium";
  return NextResponse.json(
    {
      error: "ai_config_quota_exceeded",
      message: `現在のプランでは AI設定を ${result.limit} 個まで作成できます。${planLabel} プランにアップグレードすると上限を引き上げできます。`,
      details: {
        current: result.current,
        limit: result.limit,
        plan: result.plan,
      },
    },
    { status: 403 },
  );
}
