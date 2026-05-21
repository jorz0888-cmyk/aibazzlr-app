import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkMonthlyImageQuota,
  imageQuotaExceededResponse,
  recordAiImageUsage,
} from "@/lib/quota";
import {
  generateAiImageForUser,
  GeminiGenerationError,
} from "@/lib/media/aiGenerate";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Manual AI image generation endpoint. The Gemini call, storage save,
 * and media_library insert all live in `@/lib/media/aiGenerate` so the
 * auto-attach fallback in cron + manual post generation reuses the
 * exact same pipeline. This endpoint just adds the user-scoped quota
 * gate and a JP-friendly 501 when the key isn't configured.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    ai_config_id?: string;
    prompt?: string;
  };
  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const quota = await checkMonthlyImageQuota(user.id);
  if (!quota.allowed) return imageQuotaExceededResponse(quota);

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI 画像生成は現在準備中です（GEMINI_API_KEY が未設定）。アップロードされた写真は引き続きご利用いただけます。",
        code: "gemini_not_configured",
      },
      { status: 501 },
    );
  }

  try {
    const media = await generateAiImageForUser(
      supabase,
      user.id,
      body.ai_config_id ?? null,
      body.prompt,
    );
    await recordAiImageUsage(user.id);
    return NextResponse.json({ media });
  } catch (e) {
    if (e instanceof GeminiGenerationError) {
      console.error("[media/generate] failed", {
        status: e.status,
        message: e.message,
      });
      return NextResponse.json(
        { error: e.message },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    console.error("[media/generate] failed (unknown)", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 画像生成に失敗しました" },
      { status: 502 },
    );
  }
}
