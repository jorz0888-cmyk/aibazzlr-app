import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteAiConfig,
  getAiConfigById,
  setDefaultAiConfig,
  updateAiConfig,
} from "@/lib/db/ai-configs";
import type { AiConfigUpdate } from "@/lib/supabase/types";

export const runtime = "nodejs";

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
  ];
  for (const key of passthrough) {
    if (key in body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = body[key];
    }
  }

  try {
    await updateAiConfig(auth.supabase, id, patch);
    if (body.is_default === true) {
      await setDefaultAiConfig(auth.supabase, id, auth.user.id);
    }
    return NextResponse.json({ id });
  } catch (e) {
    console.error("[ai-configs/PATCH]", e);
    return NextResponse.json(
      { error: "更新に失敗しました" },
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
