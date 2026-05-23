import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById, updateAiConfig } from "@/lib/db/ai-configs";
import {
  aiConfigQuotaExceededResponse,
  checkAiConfigQuota,
} from "@/lib/quota";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 2026-05-23 bug-4 follow-up: activate a draft ai_config from the
 * detail page (or the AI設定 list "下書きを有効化" CTA). Was missing
 * — the only path that flipped status from draft→active was the
 * hearing preview's "この設定を有効化する" button via /save, which
 * relied on the user remembering to revisit the preview screen.
 * Now any draft can be activated in-place from the detail screen.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (config.status === "active") {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  // Quota check — only count when actually transitioning to active.
  const quota = await checkAiConfigQuota(user.id);
  if (!quota.allowed) {
    return aiConfigQuotaExceededResponse(quota);
  }

  try {
    await updateAiConfig(supabase, id, { status: "active" });
    revalidatePath("/dashboard/settings/ai");
    revalidatePath(`/dashboard/settings/ai/${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[ai-configs/:id/activate] failed", info);
    return NextResponse.json(
      { error: info.message, debug: info },
      { status: 500 },
    );
  }
}
