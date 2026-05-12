import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash ? Redis.fromEnv() : null;

type Window = "10 s" | "1 m" | "1 h";

function makeLimiter(limit: number, window: Window, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: true,
    prefix,
  });
}

const SHORT_LIMIT = 5;
const MEDIUM_LIMIT = 20;
const LONG_LIMIT = 100;

const rlShort = makeLimiter(SHORT_LIMIT, "10 s", "rl:short");
const rlMedium = makeLimiter(MEDIUM_LIMIT, "1 m", "rl:medium");
const rlLong = makeLimiter(LONG_LIMIT, "1 h", "rl:long");

export interface WindowResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export interface RateLimitResult {
  success: boolean;
  short: WindowResult;
  medium: WindowResult;
  long: WindowResult;
  source: "upstash" | "fail_open";
}

function passThrough(): RateLimitResult {
  return {
    success: true,
    short: { success: true, limit: SHORT_LIMIT, remaining: SHORT_LIMIT, reset: 0 },
    medium: { success: true, limit: MEDIUM_LIMIT, remaining: MEDIUM_LIMIT, reset: 0 },
    long: { success: true, limit: LONG_LIMIT, remaining: LONG_LIMIT, reset: 0 },
    source: "fail_open",
  };
}

export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  if (!rlShort || !rlMedium || !rlLong) {
    // Upstash not configured — fail open (dev/preview safety)
    return passThrough();
  }

  try {
    const [short, medium, long] = await Promise.all([
      rlShort.limit(userId),
      rlMedium.limit(userId),
      rlLong.limit(userId),
    ]);

    return {
      success: short.success && medium.success && long.success,
      short: {
        success: short.success,
        limit: short.limit,
        remaining: short.remaining,
        reset: short.reset,
      },
      medium: {
        success: medium.success,
        limit: medium.limit,
        remaining: medium.remaining,
        reset: medium.reset,
      },
      long: {
        success: long.success,
        limit: long.limit,
        remaining: long.remaining,
        reset: long.reset,
      },
      source: "upstash",
    };
  } catch (e) {
    // Upstash transient failure — fail open to keep service alive
    console.error("[rate-limit] upstash call failed", e);
    return passThrough();
  }
}

const MESSAGES = {
  short:
    "短時間に多くのリクエストがありました。10秒ほど待ってから再度お試しください。",
  medium:
    "1分間のリクエスト上限に達しました。1分ほど待ってから再度お試しください。",
  long: "1時間のリクエスト上限に達しました。しばらくお待ちください。",
} as const;

const RETRY_AFTER: Record<keyof typeof MESSAGES, string> = {
  short: "10",
  medium: "60",
  long: "3600",
};

export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const failed: keyof typeof MESSAGES = !result.short.success
    ? "short"
    : !result.medium.success
      ? "medium"
      : "long";
  const w = result[failed];

  return NextResponse.json(
    {
      error: "rate_limit_exceeded",
      message: MESSAGES[failed],
      details: {
        window: failed,
        limit: w.limit,
        remaining: w.remaining,
        reset: w.reset,
      },
    },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": w.limit.toString(),
        "X-RateLimit-Remaining": w.remaining.toString(),
        "X-RateLimit-Reset": w.reset.toString(),
        "Retry-After": RETRY_AFTER[failed],
      },
    },
  );
}

/**
 * Simple Upstash-backed daily counter (24h TTL).
 * Used by the quota module for endpoints that have no persistence table.
 * Returns null when Upstash is not configured so the caller can fail open.
 */
export async function getDailyCounter(key: string): Promise<number | null> {
  if (!redis) return null;
  try {
    const val = await redis.get<number>(key);
    return typeof val === "number" ? val : 0;
  } catch (e) {
    console.error("[rate-limit] getDailyCounter failed", { key, e });
    return null;
  }
}

export async function incrementDailyCounter(key: string): Promise<void> {
  if (!redis) return;
  try {
    const next = await redis.incr(key);
    if (next === 1) {
      // First write — set the 24h TTL
      await redis.expire(key, 24 * 60 * 60);
    }
  } catch (e) {
    console.error("[rate-limit] incrementDailyCounter failed", { key, e });
  }
}
