import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TimelineActions } from "./TimelineActions";

type Slot = {
  key: string;
  kind: "post" | "schedule";
  jstIso: string;
  dayBucket: string;
  timeLabel: string;
  status:
    | "posted"
    | "posted_manually"
    | "pending_approval"
    | "awaiting_manual_post"
    | "failed"
    | "publishing"
    | "draft"
    | "rejected"
    | "upcoming";
  title: string;
  detail?: string | null;
  postId?: string;
  externalUrl?: string | null;
  aiConfigName?: string;
  /** Full tweet text (content + hashtags) for copy/open actions. */
  tweetText?: string;
};

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function toJst(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function jstDayBucket(date: Date, todayJst: Date): string {
  const sameDay =
    date.getUTCFullYear() === todayJst.getUTCFullYear() &&
    date.getUTCMonth() === todayJst.getUTCMonth() &&
    date.getUTCDate() === todayJst.getUTCDate();
  if (sameDay) return "今日";
  const tomorrow = new Date(todayJst);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (
    date.getUTCFullYear() === tomorrow.getUTCFullYear() &&
    date.getUTCMonth() === tomorrow.getUTCMonth() &&
    date.getUTCDate() === tomorrow.getUTCDate()
  ) {
    return "明日";
  }
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} (${WEEKDAY[date.getUTCDay()]})`;
}

function fmtTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export async function AutoPostTimeline({ userId }: { userId: string }) {
  const supabase = await createClient();

  const yesterdayIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const [postsRes, schedulesRes] = await Promise.allSettled([
    supabase
      .from("posts")
      .select(
        "id, content, hashtags, status, posted_at, created_at, platform_post_url, schedule_id, triggered_by, ai_config_id",
      )
      .eq("user_id", userId)
      .gte("created_at", yesterdayIso)
      .in("status", [
        "posted",
        "published",
        "posted_manually",
        "pending_approval",
        "awaiting_manual_post",
        "publishing",
        "failed",
        "rejected",
      ])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("schedules")
      .select("id, ai_config_id, hour, minute, weekdays, enabled")
      .eq("user_id", userId)
      .eq("enabled", true),
  ]);

  const posts =
    postsRes.status === "fulfilled" ? (postsRes.value.data ?? []) : [];
  const schedules =
    schedulesRes.status === "fulfilled"
      ? (schedulesRes.value.data ?? [])
      : [];

  // Lookup AI config names for nicer labels.
  const configIds = Array.from(
    new Set([
      ...posts.map((p) => p.ai_config_id).filter(Boolean),
      ...schedules.map((s) => s.ai_config_id),
    ]),
  ) as string[];
  let configsById = new Map<string, string>();
  if (configIds.length > 0) {
    const { data: configs } = await supabase
      .from("ai_configs")
      .select("id, name, auto_post_enabled")
      .in("id", configIds);
    configsById = new Map(
      (configs ?? [])
        .filter((c) => c.auto_post_enabled !== false)
        .map((c) => [c.id, c.name]),
    );
  }

  const slots: Slot[] = [];
  const nowUtc = new Date();
  const todayJst = toJst(nowUtc);

  for (const post of posts) {
    const eventTime = post.posted_at ?? post.created_at;
    if (!eventTime) continue;
    const jst = toJst(eventTime);
    let detail: string | null = null;
    if (post.status === "pending_approval" || post.status === "publishing") {
      detail = "承認待ち";
    } else if (post.status === "awaiting_manual_post") {
      detail = "コピペ待ち — 自分で X に投稿してください";
    }
    const status: Slot["status"] =
      post.status === "published" ? "posted" : (post.status as Slot["status"]);
    const tweetText =
      status === "awaiting_manual_post"
        ? buildPreviewTweet(post.content, post.hashtags)
        : undefined;
    slots.push({
      key: `post-${post.id}`,
      kind: "post",
      jstIso: jst.toISOString(),
      dayBucket: jstDayBucket(jst, todayJst),
      timeLabel: fmtTime(jst),
      status,
      title: shortenContent(post.content),
      detail,
      postId: post.id,
      externalUrl: post.platform_post_url,
      aiConfigName: post.ai_config_id
        ? configsById.get(post.ai_config_id)
        : undefined,
      tweetText,
    });
  }

  // Upcoming schedule slots — only for configs with auto_post enabled.
  for (const schedule of schedules) {
    if (!configsById.has(schedule.ai_config_id)) continue;
    for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
      const probe = new Date(todayJst);
      probe.setUTCDate(probe.getUTCDate() + dayOffset);
      const wd = probe.getUTCDay();
      if (!(schedule.weekdays as number[]).includes(wd)) continue;
      const slotJst = new Date(
        Date.UTC(
          probe.getUTCFullYear(),
          probe.getUTCMonth(),
          probe.getUTCDate(),
          schedule.hour,
          schedule.minute,
          0,
        ),
      );
      // Slot is in JST clock; convert back to UTC instant for comparison.
      const slotUtcMs = slotJst.getTime() - 9 * 60 * 60 * 1000;
      if (slotUtcMs <= nowUtc.getTime()) continue;
      slots.push({
        key: `sched-${schedule.id}-${dayOffset}`,
        kind: "schedule",
        jstIso: slotJst.toISOString(),
        dayBucket: jstDayBucket(slotJst, todayJst),
        timeLabel: fmtTime(slotJst),
        status: "upcoming",
        title: `${configsById.get(schedule.ai_config_id)} の自動投稿`,
        aiConfigName: configsById.get(schedule.ai_config_id),
      });
    }
  }

  // Sort chronologically (past first → upcoming).
  slots.sort((a, b) => a.jstIso.localeCompare(b.jstIso));

  if (slots.length === 0) {
    return (
      <section className="card p-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
          AUTO-POST TIMELINE
        </p>
        <h2 className="mt-1 text-base font-bold text-ink">
          自動投稿はまだ動いていません
        </h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          AI 設定の「自動投稿設定」セクションで、スケジュールを登録し
          「自動投稿 有効」をオンにすると、ここに本日と明日の予定が表示されます。
        </p>
        <Link
          href="/dashboard/settings/ai"
          className="link-cyan mt-3 inline-block text-sm"
        >
          AI設定へ →
        </Link>
      </section>
    );
  }

  // Group by day bucket.
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const arr = groups.get(slot.dayBucket) ?? [];
    arr.push(slot);
    groups.set(slot.dayBucket, arr);
  }

  return (
    <section className="card p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">
            AUTO-POST TIMELINE · JST
          </p>
          <h2 className="mt-1 text-base font-bold text-ink">
            タイムライン
          </h2>
        </div>
        <Link href="/dashboard/settings/ai" className="link-cyan text-sm">
          スケジュール管理 →
        </Link>
      </header>

      <div className="mt-5 space-y-6">
        {[...groups.entries()].map(([bucket, items]) => (
          <div key={bucket}>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-subtle">
              {bucket}
            </h3>
            <ul className="space-y-3">
              {items.map((slot) => (
                <TimelineItem key={slot.key} slot={slot} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TimelineItem({ slot }: { slot: Slot }) {
  const { color, icon, label } = badgeFor(slot.status);
  return (
    <li className="flex items-start gap-4 rounded-lg border border-line bg-white/5 p-3">
      <div className="flex w-12 flex-col items-center text-center">
        <span className="font-mono text-sm font-bold text-ink">
          {slot.timeLabel}
        </span>
        <span className={`mt-1 text-base ${color}`}>{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wider ${color}`}
          >
            {label}
          </span>
          {slot.aiConfigName && (
            <span className="text-[11px] text-ink-subtle">
              {slot.aiConfigName}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-ink">{slot.title}</p>
        {slot.detail && (
          <p className="text-[11px] text-ink-subtle">{slot.detail}</p>
        )}
        {slot.kind === "post" && slot.postId && (
          <TimelineActions
            postId={slot.postId}
            status={slot.status}
            externalUrl={slot.externalUrl ?? null}
            tweetText={slot.tweetText ?? null}
          />
        )}
      </div>
    </li>
  );
}

function shortenContent(s: string | null | undefined): string {
  if (!s) return "(本文なし)";
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function buildPreviewTweet(
  content: string | null,
  hashtags: string[] | null,
): string {
  const body = (content ?? "").trim();
  const tags = (hashtags ?? []).filter(Boolean).join(" ");
  return tags ? `${body}\n\n${tags}` : body;
}

function badgeFor(status: Slot["status"]): {
  color: string;
  icon: string;
  label: string;
} {
  switch (status) {
    case "posted":
      return { color: "bg-success/15 text-success", icon: "✓", label: "POSTED" };
    case "posted_manually":
      return {
        color: "bg-success/15 text-success",
        icon: "✓",
        label: "POSTED (MANUAL)",
      };
    case "awaiting_manual_post":
      return {
        color: "bg-warning/15 text-warning",
        icon: "📋",
        label: "COPY & POST",
      };
    case "pending_approval":
      return {
        color: "bg-warning/15 text-warning",
        icon: "⏳",
        label: "AWAITING APPROVAL",
      };
    case "publishing":
      return {
        color: "bg-cyan/15 text-cyan",
        icon: "↻",
        label: "PUBLISHING",
      };
    case "failed":
      return { color: "bg-danger/15 text-danger", icon: "✕", label: "FAILED" };
    case "rejected":
      return {
        color: "bg-ink-subtle/10 text-ink-subtle",
        icon: "—",
        label: "REJECTED",
      };
    case "upcoming":
      return {
        color: "bg-cyan/10 text-cyan",
        icon: "○",
        label: "SCHEDULED",
      };
    default:
      return { color: "bg-white/5 text-ink", icon: "·", label: "DRAFT" };
  }
}
