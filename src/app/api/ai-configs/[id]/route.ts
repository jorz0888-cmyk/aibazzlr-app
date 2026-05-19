import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteAiConfig,
  getAiConfigById,
  setDefaultAiConfig,
  updateAiConfig,
} from "@/lib/db/ai-configs";
import { toStringArray } from "@/lib/ai/normalize-extracted";
import {
  AI_CONFIG_DEFAULTS,
  applyAiConfigDefaults,
} from "@/lib/db/ai-config-defaults";
import { extractDbError } from "@/lib/db/error";
import type { AiConfigUpdate } from "@/lib/supabase/types";

// Columns that are NOT NULL in production but lack DB-side defaults. If the
// caller sends `null` (e.g. the user cleared the input), substitute the safe
// default rather than letting Postgres reject the UPDATE.
const NOT_NULL_FIELDS = new Set<keyof AiConfigUpdate>([
  "posting_frequency",
  "posting_times",
  "social_account_ids",
  "requires_approval",
  "status",
  "is_default",
  "hashtags_per_post",
  "account_mode",
]);

const ARRAY_FIELDS = new Set<keyof AiConfigUpdate>([
  "ng_words",
  "must_include_elements",
  "good_examples",
  "bad_examples",
  "hashtag_pool",
  "menu_items",
  "seasonal_items",
  "real_episodes",
  "announcement_topics",
  "social_account_ids",
]);

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function authorize(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { supabase, user, config };
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));

  const patch: AiConfigUpdate = {};
  const passthrough: (keyof AiConfigUpdate)[] = [
    "name",
    "industry",
    "business_name",
    "business_description",
    "persona_role",
    "world_view",
    "voice_tone",
    "target_audience",
    "ng_words",
    "must_include_elements",
    "good_examples",
    "bad_examples",
    "hashtag_pool",
    "hashtags_per_post",
    "posting_frequency",
    "posting_times",
    "social_account_ids",
    "generated_system_prompt",
    "requires_approval",
    "status",
    // Phase 5.8 real-mode fields
    "account_mode",
    "business_hours",
    "closed_days",
    "address",
    "price_range",
    "menu_items",
    "seasonal_items",
    "real_episodes",
    "announcement_topics",
    // Phase 11 auto-post
    "posting_mode",
    "auto_post_enabled",
    // Phase 13 strategy
    "monthly_goal",
    "target_audience_preset",
    "target_audience_description",
  ];
  for (const key of passthrough) {
    if (key in body) {
      const raw = body[key];
      // 1) Array fields: coerce to string[] so objects like {name,price} are
      //    rendered into "name（price）" strings (avoids text[] type errors).
      // 2) NOT NULL fields: if caller sent null/undefined, fall back to the
      //    safe default rather than letting Postgres reject the UPDATE.
      let value: unknown = ARRAY_FIELDS.has(key) ? toStringArray(raw) : raw;
      if (
        NOT_NULL_FIELDS.has(key) &&
        (value === null || value === undefined)
      ) {
        value =
          AI_CONFIG_DEFAULTS[key as keyof typeof AI_CONFIG_DEFAULTS];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = value;
    }
  }

  try {
    await updateAiConfig(auth.supabase, id, patch);
    if (body.is_default === true) {
      await setDefaultAiConfig(auth.supabase, id, auth.user.id);
    }
    return NextResponse.json({ id });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[AI-CONFIGS-PATCH-FAILURE]", {
      configId: id,
      errorCode: info.code,
      errorMessage: info.message,
      errorDetails: info.details,
      errorHint: info.hint,
      patchedFields: Object.keys(patch),
    });
    return NextResponse.json(
      { error: "更新に失敗しました", debug: info },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  try {
    await deleteAiConfig(auth.supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[ai-configs/DELETE]", e);
    return NextResponse.json(
      { error: "削除に失敗しました" },
      { status: 500 },
    );
  }
}
