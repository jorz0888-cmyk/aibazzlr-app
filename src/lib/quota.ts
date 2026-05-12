import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDailyCounter, incrementDailyCounter } from "@/lib/rate-limit";

export const QUOTAS = {
  hearing: 3,
  post: 30,
  test_post: 10,
} as const;

export type QuotaType = keyof typeof QUOTAS;

export interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: Date;
  quotaType: QuotaType;
  source: "db" | "redis" | "fail_open";
}

const DB_TABLE: Record<Exclude<QuotaType, "test_post">, string> = {
  hearing: "ai_hearing_sessions",
  post: "posts",
};

// test_post has no persistence table — we count in Upstash Redis (24h TTL).
// When Upstash is not configured we fail open, matching rate-limit behavior.

function nextResetAt(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export async function checkDailyQuota(
  userId: string,
  quotaType: QuotaType,
): Promise<QuotaResult> {
  const limit = QUOTAS[quotaType];
  const resetAt = nextResetAt();

  if (quotaType === "test_post") {
    const current = await getDailyCounter(`quota:test_post:${userId}`);
    if (current === null) {
      // Upstash not configured — fail open
      return {
        allowed: true,
        current: 0,
        limit,
        resetAt,
        quotaType,
        source: "fail_open",
      };
    }
    return {
      allowed: current < limit,
      current,
      limit,
      resetAt,
      quotaType,
      source: "redis",
    };
  }

  const tableName = DB_TABLE[quotaType];
  const supabase = await createClient();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneDayAgo);

  if (error) {
    // Fail open on DB error — service continuity > strict quota
    console.error("[quota] DB count failed", { quotaType, tableName, error });
    return {
      allowed: true,
      current: 0,
      limit,
      resetAt,
      quotaType,
      source: "fail_open",
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
  };
}

/**
 * Increment the test_post counter after a successful generation.
 * No-op for db-backed quotas (the underlying row insert is the counter).
 */
export async function recordQuotaUsage(
  userId: string,
  quotaType: QuotaType,
): Promise<void> {
  if (quotaType !== "test_post") return;
  await incrementDailyCounter(`quota:test_post:${userId}`);
}

const LABEL: Record<QuotaType, string> = {
  hearing: "ヒアリング",
  post: "投稿生成",
  test_post: "テスト投稿",
};

export function quotaExceededResponse(result: QuotaResult): NextResponse {
  return NextResponse.json(
    {
      error: "daily_quota_exceeded",
      message: `本日の${LABEL[result.quotaType]}回数の上限（${result.limit}回）に達しました。明日また使えるようになります。`,
      details: {
        current: result.current,
        limit: result.limit,
        resetAt: result.resetAt.toISOString(),
        quotaType: result.quotaType,
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
