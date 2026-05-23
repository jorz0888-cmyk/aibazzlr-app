import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAiConfig,
  getAiConfigById,
  updateAiConfig,
} from "@/lib/db/ai-configs";
import { applyAiConfigDefaults } from "@/lib/db/ai-config-defaults";
import { toStringArray } from "@/lib/ai/normalize-extracted";
import type {
  AccountMode,
  AiConfigInsert,
  AiConfigUpdate,
  Database,
  ExtractedHearingData,
} from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * 2026-05-23 T1 BUGFIX: shared helper that upserts an ai_configs row
 * (status='draft') from a hearing session's extracted data.
 *
 * Previously this lived inline in /api/ai-hearing/[sessionId]/finalize,
 * so it ONLY ran when the client POSTed to /finalize. But the actual
 * completion path is /api/ai-hearing/[sessionId]/message: when Claude
 * streams the final JSON on the last turn, /message inline-flips the
 * session to status='completed' and saves extracted_data. The client
 * sees completed → redirects to preview, never POSTing /finalize. As a
 * result drafts were missing for most sessions (verified by querying
 * ai_hearing_sessions: 5 of 9 most-recent completed sessions had
 * ai_config_id=null after the "fix").
 *
 * Now this helper is callable from ALL completion entry points:
 *   1. /api/ai-hearing/[sessionId]/message  (inline completion path)
 *   2. /api/ai-hearing/[sessionId]/finalize (explicit POST path)
 *   3. preview server component on render   (idempotent backfill)
 *
 * Idempotent on session.ai_config_id — first call inserts and links;
 * subsequent calls UPDATE the same row, preserving the activated
 * status and any user edits made in the AI設定詳細 page.
 */
export async function ensureAiConfigFromHearing(opts: {
  client: Client;
  userId: string;
  sessionId: string;
  existingAiConfigId: string | null;
  extracted: ExtractedHearingData;
  prompt: string;
  sessionMode: AccountMode;
  industry: string | null;
}): Promise<{ aiConfigId: string | null }> {
  const {
    client,
    userId,
    sessionId,
    existingAiConfigId,
    extracted,
    prompt,
    sessionMode,
    industry,
  } = opts;

  const sharedFields = {
    account_mode: sessionMode,
    industry: extracted.industry ?? industry ?? null,
    business_name: extracted.business_name ?? null,
    business_description: extracted.business_description ?? null,
    persona_role: extracted.persona_role ?? null,
    world_view: extracted.world_view ?? null,
    voice_tone: extracted.voice_tone ?? null,
    target_audience: extracted.target_audience ?? null,
    ng_words: toStringArray(extracted.ng_words),
    must_include_elements: toStringArray(extracted.must_include_elements),
    good_examples: toStringArray(extracted.good_examples),
    hashtag_pool: toStringArray(extracted.hashtag_pool),
    generated_system_prompt: prompt,
    business_hours: extracted.business_hours ?? null,
    closed_days: extracted.closed_days ?? null,
    address: extracted.address ?? null,
    price_range: extracted.price_range ?? null,
    menu_items: toStringArray(extracted.menu_items),
    seasonal_items: toStringArray(extracted.seasonal_items),
    real_episodes: toStringArray(extracted.real_episodes),
    announcement_topics: toStringArray(extracted.announcement_topics),
  };

  if (existingAiConfigId) {
    try {
      const existing = await getAiConfigById(client, existingAiConfigId);
      if (existing && existing.user_id === userId) {
        // Refresh the AI-generated fields, but DON'T touch:
        //   - status (preserve activation if user already activated)
        //   - name  (preserve any rename the user made on the detail page)
        const patch: AiConfigUpdate = sharedFields;
        await updateAiConfig(client, existingAiConfigId, patch);
        return { aiConfigId: existingAiConfigId };
      }
      console.warn(
        "[ai-config-from-hearing] session.ai_config_id missing — re-creating",
        { sessionId, existingAiConfigId },
      );
    } catch (e) {
      console.warn(
        "[ai-config-from-hearing] UPDATE path failed, falling back to INSERT",
        e,
      );
    }
  }

  const insert: AiConfigInsert = applyAiConfigDefaults({
    user_id: userId,
    name: extracted.business_name?.trim() || "新しいAI設定",
    status: "draft",
    ...sharedFields,
  });
  try {
    const config = await createAiConfig(client, insert);
    await client
      .from("ai_hearing_sessions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ ai_config_id: config.id } as any)
      .eq("id", sessionId);
    return { aiConfigId: config.id };
  } catch (e) {
    console.error(
      "[ai-config-from-hearing] INSERT failed — no draft saved",
      e,
    );
    return { aiConfigId: null };
  }
}
