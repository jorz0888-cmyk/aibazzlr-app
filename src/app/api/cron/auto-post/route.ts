import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { generatePostDraft } from "@/lib/posts/generator";
import { autoAttachLibraryImage } from "@/lib/media/autoSelect";
import { recordTopicTags } from "@/lib/strategy/topic-tracking";
import { publishPostToX } from "@/lib/posts/publisher";
import { applyPostDefaults } from "@/lib/db/post-defaults";
import { updatePostWithRetry } from "@/lib/db/post-update";
import { checkMonthlyPostQuota } from "@/lib/quota";
import type {
  AiConfig,
  Platform,
  Post,
  Schedule,
} from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel-Cron-triggered auto-post handler. Runs every minute. Looks up
 * schedules whose (hour, minute, weekday) match the current JST minute,
 * generates a draft via the existing pipeline, and either auto-posts to X
 * (mode='auto') or leaves the post in `pending_approval` for the user to
 * review on the dashboard (mode='approval').
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We accept
 * either that header or a matching `?secret=...` query param (handy for
 * manual smoke tests via curl).
 */
export async function GET(request: NextRequest) {
  console.log("[cron/auto-post] ====== 実行開始 ======");
  if (!isAuthorized(request)) {
    console.warn("[cron/auto-post] auth failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Compute "now" in JST (UTC+9). All schedules store JST hour/minute.
  const nowUtc = new Date();
  const jst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const currentHour = jst.getUTCHours();
  const currentMinute = jst.getUTCMinutes();
  const currentWeekday = jst.getUTCDay();
  const jstClock = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
  const weekdayLabel = ["日", "月", "火", "水", "木", "金", "土"][currentWeekday];

  console.log("[cron/auto-post] UTC raw     :", nowUtc.toISOString());
  console.log(
    "[cron/auto-post] UTC h:m     :",
    `${nowUtc.getUTCHours()}:${nowUtc.getUTCMinutes()}`,
  );
  console.log(
    "[cron/auto-post] JST 換算    :",
    `${jstClock}  (weekday=${currentWeekday} / ${weekdayLabel})`,
  );

  // 2. Find schedules that fire at exactly this minute (in JST).
  const { data: schedules, error: schedulesErr } = await admin
    .from("schedules")
    .select("*")
    .eq("hour", currentHour)
    .eq("minute", currentMinute)
    .eq("enabled", true);

  if (schedulesErr) {
    console.error("[cron/auto-post] schedule lookup failed", schedulesErr);
    return NextResponse.json(
      { error: "schedule lookup failed" },
      { status: 500 },
    );
  }

  console.log(
    `[cron/auto-post] 取得 schedules: ${schedules?.length ?? 0} 件`,
    JSON.stringify(
      (schedules ?? []).map((s) => ({
        id: s.id,
        ai_config_id: s.ai_config_id,
        hour: s.hour,
        minute: s.minute,
        weekdays: s.weekdays,
        enabled: s.enabled,
      })),
    ),
  );

  const eligible = (schedules ?? []).filter((s: Schedule) => {
    const weekdayMatch = (s.weekdays ?? []).includes(currentWeekday);
    if (!weekdayMatch) {
      console.log(
        `[cron/auto-post] 照合: schedule ${s.id} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} weekdays=${JSON.stringify(s.weekdays)} vs now=${jstClock} weekday=${currentWeekday} → 一致せず（曜日対象外）`,
      );
      return false;
    }
    console.log(
      `[cron/auto-post] 照合: schedule ${s.id} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} vs now=${jstClock} → 一致 ✓`,
    );
    return true;
  });

  if (eligible.length === 0) {
    console.log(
      "[cron/auto-post] スキップ: 該当 schedule なし（時刻・曜日いずれかが不一致）",
    );
    return NextResponse.json({
      status: "no_schedules",
      time: jstClock,
      weekday: currentWeekday,
    });
  }

  console.log(
    `[cron/auto-post] eligible: ${eligible.length} 件、processSchedule に進む`,
  );
  const results: Array<Record<string, unknown>> = [];
  for (const schedule of eligible) {
    const r = await processSchedule(admin, schedule);
    console.log(
      `[cron/auto-post] schedule ${schedule.id} 結果: status=${r.status}`,
      r,
    );
    results.push(r);
  }

  console.log("[cron/auto-post] ====== 実行完了 ======");
  return NextResponse.json({
    status: "completed",
    time: jstClock,
    weekday: currentWeekday,
    processed: results.length,
    results,
  });
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/auto-post] CRON_SECRET is not configured");
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${expected}`) return true;
  const query = request.nextUrl.searchParams.get("secret");
  if (query && query === expected) return true;
  return false;
}

async function processSchedule(
  admin: ReturnType<typeof createAdminClient>,
  schedule: Schedule,
): Promise<Record<string, unknown>> {
  // Guard A: duplicate-fire protection. Vercel cron can occasionally
  // trigger the same minute twice across regions; we use the
  // (schedule_id, minute window) pair to detect that we already produced
  // a post for this firing.
  try {
    const minuteFloor = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("posts")
      .select("id")
      .eq("schedule_id", schedule.id)
      .gte("created_at", minuteFloor)
      .limit(1);
    if (recent && recent.length > 0) {
      console.log(
        `[cron/auto-post] スキップ: schedule ${schedule.id} は直近5分以内に既に処理済み`,
      );
      return { schedule_id: schedule.id, status: "already_processed" };
    }
  } catch (e) {
    console.error("[cron/auto-post] dedupe lookup failed", e);
    // fall through — better to risk a duplicate than to skip everyone
  }

  // Guard B: auto-post must be enabled on the AI config.
  const config: AiConfig | null = await getAiConfigById(admin, schedule.ai_config_id);
  if (!config || !config.auto_post_enabled) {
    // Include config name so Vercel logs reveal the offender at a glance.
    console.info("[cron/auto-post] skipped — auto_post_enabled is OFF", {
      schedule_id: schedule.id,
      ai_config_id: schedule.ai_config_id,
      config_name: config?.name ?? null,
    });
    return {
      schedule_id: schedule.id,
      ai_config_id: schedule.ai_config_id,
      config_name: config?.name ?? null,
      status: "auto_post_disabled",
    };
  }

  // Guard C: monthly quota.
  const quota = await checkMonthlyPostQuota(schedule.user_id);
  if (!quota.allowed) {
    console.log(
      `[cron/auto-post] スキップ: schedule ${schedule.id} 月次クォータ超過 (${quota.used}/${quota.limit})`,
    );
    return {
      schedule_id: schedule.id,
      status: "quota_exceeded",
      used: quota.used,
      limit: quota.limit,
    };
  }

  // Guard D: there must be at least one social account to target. We pick
  // the user's primary X account (the only platform implemented today).
  const { data: account } = await admin
    .from("social_accounts")
    .select("*")
    .eq("user_id", schedule.user_id)
    .eq("platform", "x")
    .eq("is_primary", true)
    .maybeSingle();
  const target =
    account ??
    (
      await admin
        .from("social_accounts")
        .select("*")
        .eq("user_id", schedule.user_id)
        .eq("platform", "x")
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;
  if (!target) {
    console.log(
      `[cron/auto-post] スキップ: schedule ${schedule.id} に紐づく user ${schedule.user_id} の X アカウント連携なし`,
    );
    return {
      schedule_id: schedule.id,
      status: "no_social_account",
    };
  }

  // 1. Generate the draft via Claude. Phase 13: pass the scheduled JST clock
  //    so the strategy section can flag "this is an optimal time" for the
  //    configured goal. Phase 11.5: also pass the last 10 opening snippets
  //    so the generator avoids repeating its openings.
  const scheduledTimeJst = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  const { data: recentOpeningsRows } = await admin
    .from("posts")
    .select("opening_snippet")
    .eq("ai_config_id", config.id)
    .not("opening_snippet", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  const recentOpenings = (recentOpeningsRows ?? [])
    .map((r) => r.opening_snippet)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  let generated;
  try {
    generated = await generatePostDraft(config, undefined, {
      scheduledTimeJst,
      recentOpenings,
    });
  } catch (e) {
    console.error("[cron/auto-post] generation failed", {
      schedule_id: schedule.id,
      error: e,
    });
    return {
      schedule_id: schedule.id,
      status: "generation_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 2. Persist with a status that matches the configured posting mode.
  //    - auto:     'draft' → publish path below flips to 'publishing' → 'posted'
  //    - approval: 'pending_approval' → user clicks approve on dashboard
  //    - manual:   'awaiting_manual_post' → user copies text + posts in X themselves
  const initialStatus: Post["status"] =
    config.posting_mode === "auto"
      ? "draft"
      : config.posting_mode === "manual"
        ? "awaiting_manual_post"
        : "pending_approval";

  // Phase 12: auto-attach a library image if the user has one.
  const picked = await autoAttachLibraryImage(
    admin,
    schedule.user_id,
    config.id,
    generated.content,
    generated.hashtags,
  );

  const payload = applyPostDefaults({
    user_id: schedule.user_id,
    ai_config_id: config.id,
    social_account_id: target.id,
    platform: target.platform as Platform,
    content: generated.content,
    hashtags: generated.hashtags,
    theme: generated.theme,
    generation_metadata: generated.metadata,
    status: initialStatus,
    triggered_by: "schedule",
    schedule_id: schedule.id,
    media_id: picked.media_id,
    image_url: picked.image_url,
    strategic_intent: generated.strategic_intent,
    topic_tags: generated.topic_tags,
    opening_snippet: generated.opening_snippet,
  });

  const { data: inserted, error: insertErr } = await admin
    .from("posts")
    .insert(payload)
    .select("*")
    .single();

  if (insertErr || !inserted) {
    console.error("[cron/auto-post] insert failed", insertErr);
    return {
      schedule_id: schedule.id,
      status: "insert_failed",
      error: insertErr?.message,
    };
  }

  // Phase 13: update recent topic tags so the next firing avoids repeats.
  if (generated.topic_tags.length > 0) {
    void recordTopicTags(admin, config.id, generated.topic_tags);
  }

  // 3a. Approval mode — stop here. User reviews on dashboard.
  if (config.posting_mode === "approval") {
    return {
      schedule_id: schedule.id,
      post_id: inserted.id,
      status: "awaiting_approval",
    };
  }

  // 3b. Manual / copy-paste mode — also stop here. User copies the text
  //     and posts it in the X app themselves; we never touch the X API,
  //     which is the whole point (new accounts get 403'd by X otherwise).
  if (config.posting_mode === "manual") {
    return {
      schedule_id: schedule.id,
      post_id: inserted.id,
      status: "awaiting_manual_post",
    };
  }

  // 3c. Auto mode — immediately publish to X.
  const lockRes = await admin
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "publishing" } as any)
    .eq("id", inserted.id)
    .is("platform_post_id", null)
    .eq("status", "draft")
    .select("id");

  if (!lockRes.data || lockRes.data.length === 0) {
    return {
      schedule_id: schedule.id,
      post_id: inserted.id,
      status: "lock_failed",
    };
  }

  const publish = await publishPostToX(admin, inserted, schedule.user_id);
  if (publish.ok) {
    await updatePostWithRetry(admin, inserted.id, {
      platform_post_id: publish.tweetId,
      platform_post_url: publish.url,
      external_post_id: publish.tweetId,
      status: "posted",
      posted_at: publish.postedAt,
      error_message: null,
    });
    return {
      schedule_id: schedule.id,
      post_id: inserted.id,
      status: "posted",
      tweet_id: publish.tweetId,
    };
  }

  // Auto mode + X failure → mark failed with the error, keep retry_count
  // moving forward (so the existing 3-retry guard kicks in if a user
  // manually retries from the dashboard).
  await admin
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      status: "failed",
      error_message: publish.errorMessage,
      retry_count: (inserted.retry_count ?? 0) + 1,
    } as any)
    .eq("id", inserted.id);

  return {
    schedule_id: schedule.id,
    post_id: inserted.id,
    status: "post_failed",
    error: publish.errorMessage,
  };
}
