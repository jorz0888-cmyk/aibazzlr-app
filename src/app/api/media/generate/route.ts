import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkMonthlyImageQuota,
  imageQuotaExceededResponse,
  recordAiImageUsage,
} from "@/lib/quota";
import {
  buildStoragePath,
  extForMime,
  uploadToUserMedia,
} from "@/lib/media/storage";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Phase 12: AI image generation endpoint. The wiring is complete (quota
 * check, storage save, library row, counter increment); only the actual
 * Gemini call is gated behind GEMINI_API_KEY. When the key is missing we
 * return 501 and document the requirement so the caller can fall back to
 * "no image" cleanly.
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

  // Quota gate — same shape as monthly post quota.
  const quota = await checkMonthlyImageQuota(user.id);
  if (!quota.allowed) return imageQuotaExceededResponse(quota);

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI 画像生成は現在準備中です（GEMINI_API_KEY が未設定）。アップロードされた写真は引き続きご利用いただけます。",
        code: "gemini_not_configured",
      },
      { status: 501 },
    );
  }

  // Call Gemini's image generation endpoint.
  // The REST contract for image-capable Gemini models returns one or more
  // image parts; we take the first. Cast through `any` for the schema since
  // there is no official TS SDK we depend on yet.
  type GeminiInlineImage = {
    inline_data?: { mime_type?: string; data?: string };
    inlineData?: { mimeType?: string; data?: string };
  };
  type GeminiCandidate = {
    content?: { parts?: GeminiInlineImage[] };
  };
  type GeminiResponse = { candidates?: GeminiCandidate[] };

  let geminiResp: Response;
  try {
    geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: body.prompt }],
            },
          ],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      },
    );
  } catch (e) {
    console.error("[media/generate] gemini fetch failed", e);
    return NextResponse.json(
      {
        error: `Gemini への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    );
  }

  if (!geminiResp.ok) {
    const errText = await geminiResp.text().catch(() => "");
    console.error("[media/generate] gemini error", geminiResp.status, errText);
    return NextResponse.json(
      {
        error: `Gemini API エラー (${geminiResp.status}): ${errText.slice(0, 200)}`,
      },
      { status: 502 },
    );
  }

  const json = (await geminiResp.json()) as GeminiResponse;
  const part = json.candidates?.[0]?.content?.parts?.find(
    (p) => p.inline_data?.data || p.inlineData?.data,
  );
  const inlineSnake = part?.inline_data;
  const inlineCamel = part?.inlineData;
  const base64 = inlineSnake?.data ?? inlineCamel?.data;
  const mime =
    inlineSnake?.mime_type ?? inlineCamel?.mimeType ?? "image/png";
  if (!base64) {
    return NextResponse.json(
      { error: "Gemini からの応答に画像データが含まれていませんでした" },
      { status: 502 },
    );
  }

  const buffer = Buffer.from(base64, "base64");
  // Convert to a Blob so supabase-js accepts it (Buffer is not a valid type
  // for the SDK's upload signature on Edge runtimes).
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  const ext = extForMime(mime);
  const aiConfigId = body.ai_config_id ?? null;
  const id = randomUUID();
  const path = buildStoragePath(user.id, aiConfigId, `${id}.${ext}`);

  let publicUrl: string;
  try {
    const res = await uploadToUserMedia(supabase, path, blob, mime);
    publicUrl = res.publicUrl;
  } catch (e) {
    console.error("[media/generate] storage upload failed", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Storage 保存に失敗しました",
      },
      { status: 502 },
    );
  }

  const { data: row, error } = await supabase
    .from("media_library")
    .insert({
      user_id: user.id,
      ai_config_id: aiConfigId,
      storage_path: path,
      public_url: publicUrl,
      source: "ai_generated",
      tags: [],
      ai_description: body.prompt,
      file_size_bytes: buffer.length,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[media/generate] db insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAiImageUsage(user.id);
  return NextResponse.json({ media: row });
}
