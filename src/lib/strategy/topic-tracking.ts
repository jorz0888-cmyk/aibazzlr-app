import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, RecentTopicEntry } from "@/lib/supabase/types";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 60;

type Client = SupabaseClient<Database>;

function isValidTopic(t: unknown): t is string {
  return typeof t === "string" && t.length > 0 && t.length <= 64;
}

function isRecentEntry(v: unknown): v is RecentTopicEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as { topic?: unknown; last_used?: unknown };
  return typeof o.topic === "string" && typeof o.last_used === "string";
}

export function pruneRecent(
  entries: RecentTopicEntry[],
  now: number = Date.now(),
): RecentTopicEntry[] {
  const cutoff = new Date(now - WINDOW_MS).toISOString();
  return entries.filter((e) => e.last_used > cutoff);
}

/**
 * Merge `newTopics` into the existing `recent_topics` array on the
 * ai_configs row, prune entries older than 30 days, and write back.
 * Fail-soft: any error is logged but never thrown so the post insert
 * doesn't get rolled back over a tracking miss.
 */
export async function recordTopicTags(
  client: Client,
  aiConfigId: string,
  newTopics: string[],
): Promise<void> {
  try {
    const clean = newTopics.filter(isValidTopic);
    if (clean.length === 0) return;

    const { data, error } = await client
      .from("ai_configs")
      .select("recent_topics")
      .eq("id", aiConfigId)
      .single();
    if (error || !data) {
      console.warn("[strategy/topic-tracking] read failed", error);
      return;
    }
    const existingRaw = Array.isArray(data.recent_topics) ? data.recent_topics : [];
    const existing: RecentTopicEntry[] = existingRaw
      .filter(isRecentEntry)
      .slice(0, MAX_ENTRIES);

    const now = new Date().toISOString();
    const next: RecentTopicEntry[] = pruneRecent(existing);
    for (const topic of clean) {
      const idx = next.findIndex((e) => e.topic === topic);
      if (idx >= 0) {
        next[idx] = { topic, last_used: now };
      } else {
        next.push({ topic, last_used: now });
      }
    }
    // Cap the array so misbehaving generations can't blow up the row.
    const capped = next.slice(-MAX_ENTRIES);

    const { error: updateErr } = await client
      .from("ai_configs")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ recent_topics: capped } as any)
      .eq("id", aiConfigId);
    if (updateErr) {
      console.warn("[strategy/topic-tracking] update failed", updateErr);
    }
  } catch (e) {
    console.warn("[strategy/topic-tracking] unexpected failure", e);
  }
}

export function formatRecentTopicsForPrompt(
  recent: RecentTopicEntry[] | null | undefined,
): string {
  const arr = Array.isArray(recent) ? recent.filter(isRecentEntry) : [];
  if (arr.length === 0) return "（過去投稿なし）";
  const pruned = pruneRecent(arr);
  return pruned
    .map(
      (e) =>
        `- ${e.topic} (最終: ${new Date(e.last_used).toISOString().slice(0, 10)})`,
    )
    .join("\n");
}
