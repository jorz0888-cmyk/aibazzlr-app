import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiConfig,
  ContentPillar,
  Database,
} from "@/lib/supabase/types";
import {
  generateContentPillars,
  selectPillarAntiRecency,
} from "@/lib/posts/pillars";
import { getSeasonalHint } from "@/lib/posts/seasonal";

type Client = SupabaseClient<Database>;

const RECENT_BODY_LIMIT = 10;
const RECENT_PILLAR_LIMIT = 20;
const RECENT_OPENING_LIMIT = 10;

export type GenerateContext = {
  pillar: ContentPillar | null;
  seasonalHint: string;
  recentBodies: string[];
  recentOpenings: string[];
  /** True iff we just minted pillars on the fly (caller may want to log). */
  pillarsGeneratedNow: boolean;
};

/**
 * Build everything generatePostDraft() needs that's specific to the
 * call site's "current state" (vs the static AI config): pick the next
 * pillar, fetch the seasonal hint, fetch recent post bodies for the
 * "don't repeat" cue.
 *
 * Side effect: if `aiConfig.content_pillars` is empty we call the LLM
 * to mint a set, persist them, and mutate the in-memory aiConfig so
 * the caller's downstream code (which already has the object) sees
 * the new pillars without a re-read.
 *
 * The caller can pass `aiConfigPatchClient` to override the writer for
 * the lazy update — cron uses the admin client (no RLS) while the
 * manual route uses the user-scoped server client (RLS-checked).
 */
export async function buildGenerateContext(
  reader: Client,
  aiConfig: AiConfig,
  writer: Client = reader,
): Promise<GenerateContext> {
  let pillars = aiConfig.content_pillars ?? [];
  let pillarsGeneratedNow = false;

  // 1. Lazy-generate pillars if missing. We don't fail the whole post
  //    generation if this errors — pillar=null degrades gracefully.
  if (pillars.length === 0) {
    try {
      const minted = await generateContentPillars(aiConfig);
      if (minted.length > 0) {
        const { error: updateErr } = await writer
          .from("ai_configs")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ content_pillars: minted } as any)
          .eq("id", aiConfig.id);
        if (updateErr) {
          console.error("[generate-context] failed to persist new pillars", {
            ai_config_id: aiConfig.id,
            error: updateErr,
          });
        } else {
          pillars = minted;
          aiConfig.content_pillars = minted;
          pillarsGeneratedNow = true;
          console.log("[generate-context] minted pillars on the fly", {
            ai_config_id: aiConfig.id,
            count: minted.length,
          });
        }
      }
    } catch (e) {
      console.warn("[generate-context] pillar LLM call failed", {
        ai_config_id: aiConfig.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2. Recent post history — one read covers both the pillar
  //    anti-recency lookup AND the "don't repeat bodies" cue, since
  //    they share an ai_config + ordered by created_at desc.
  const { data: recentRows } = await reader
    .from("posts")
    .select("pillar_id, content, opening_snippet")
    .eq("ai_config_id", aiConfig.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_PILLAR_LIMIT);
  const rows = recentRows ?? [];

  const recentPillarIds = rows.map((r) => r.pillar_id ?? null);
  const recentBodies = rows
    .map((r) => (typeof r.content === "string" ? r.content : ""))
    .filter(Boolean)
    .slice(0, RECENT_BODY_LIMIT);
  const recentOpenings = rows
    .map((r) =>
      typeof r.opening_snippet === "string" ? r.opening_snippet : "",
    )
    .filter(Boolean)
    .slice(0, RECENT_OPENING_LIMIT);

  // 3. Anti-recency pick.
  const pillar = selectPillarAntiRecency(pillars, recentPillarIds);

  console.log("[generate-context] ready", {
    ai_config_id: aiConfig.id,
    pillar_count: pillars.length,
    picked_pillar: pillar ? { id: pillar.id, name: pillar.name } : null,
    recent_history_size: rows.length,
    pillars_generated_now: pillarsGeneratedNow,
  });

  return {
    pillar,
    seasonalHint: getSeasonalHint(),
    recentBodies,
    recentOpenings,
    pillarsGeneratedNow,
  };
}
