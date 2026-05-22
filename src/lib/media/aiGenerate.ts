import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type {
  ContentPillar,
  Database,
  MediaLibraryRow,
} from "@/lib/supabase/types";
import {
  buildStoragePath,
  extForMime,
  uploadToUserMedia,
} from "@/lib/media/storage";

type Client = SupabaseClient<Database>;

export class GeminiGenerationError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.name = "GeminiGenerationError";
  }
}

/**
 * Synthesize a Gemini prompt that produces an SNS-appropriate photo
 * for a Japanese small-business post. We avoid embedding the literal
 * Japanese sentence (Gemini's text-in-image rendering is unreliable
 * and the user almost never wants a screenshot of their caption);
 * instead we lean on the topic tags + a stylistic frame.
 */
export function buildImagePromptFromPost(
  content: string,
  topicTags: string[],
  hashtags: string[],
  options: {
    /** Phase 17: the pillar the post was generated for. */
    pillar?: ContentPillar | null;
    /** Phase 17: ai_description / prompt of the last N images this
     *  config attached. Passed to Gemini as "explicitly do not look
     *  like these" so visually identical loops break. */
    recentImageDescriptions?: string[];
  } = {},
): string {
  const topics = [...topicTags, ...hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const topicLine =
    topics.length > 0
      ? `Subject / scene: ${topics.join(", ")}.`
      : "Subject / scene: a warm everyday moment hinted at by the caption.";
  const snippet = content.slice(0, 140).replace(/\s+/g, " ");
  const parts: string[] = [
    "Photorealistic 4:5 lifestyle photo suitable for a Japanese small-business social post.",
    topicLine,
  ];
  // Phase 17: pillar adds an angle hint Gemini can interpret as
  // composition / framing direction. Kept short so it doesn't dwarf
  // the content-derived signal.
  if (options.pillar) {
    parts.push(
      `Angle: ${options.pillar.name} — ${options.pillar.description}.`,
    );
  }
  parts.push(
    `Mood / caption context (do NOT render any text or watermark in the image): "${snippet}".`,
  );
  // Phase 17: anti-similarity hint. Surface the most-recent images'
  // descriptions and tell Gemini to differ. Trimmed so the prompt
  // stays under model attention limits.
  const recent = (options.recentImageDescriptions ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (recent.length > 0) {
    const list = recent
      .map((d, i) => `(${i + 1}) ${d.slice(0, 120)}`)
      .join(" | ");
    parts.push(
      `Recent images for this account were: ${list}. The new image must be visually distinct — different subject, composition, color palette, or framing.`,
    );
  }
  parts.push(
    "Natural lighting, warm color palette, shallow depth of field, no on-image text, no logos.",
  );
  return parts.join(" ");
}

type GeminiInlineImage = {
  inline_data?: { mime_type?: string; data?: string };
  inlineData?: { mimeType?: string; data?: string };
};
type GeminiCandidate = { content?: { parts?: GeminiInlineImage[] } };
type GeminiResponse = { candidates?: GeminiCandidate[] };

/**
 * Call Gemini's image-capable model with `prompt` and return the raw
 * image bytes + mime. Throws GeminiGenerationError on any failure so
 * the auto-attach fallback can swallow it and degrade to text-only.
 */
export async function callGeminiImage(prompt: string): Promise<{
  buffer: Buffer;
  mime: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  if (!apiKey) {
    throw new GeminiGenerationError("GEMINI_API_KEY 未設定", 501);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log("[media/aiGenerate] gemini call", {
    model,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 120),
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
  } catch (e) {
    throw new GeminiGenerationError(
      `Gemini fetch error: ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new GeminiGenerationError(
      `Gemini API (${resp.status}): ${text.slice(0, 200)}`,
      resp.status,
    );
  }

  const json = (await resp.json()) as GeminiResponse;
  const part = json.candidates?.[0]?.content?.parts?.find(
    (p) => p.inline_data?.data || p.inlineData?.data,
  );
  const base64 = part?.inline_data?.data ?? part?.inlineData?.data;
  const mime =
    part?.inline_data?.mime_type ?? part?.inlineData?.mimeType ?? "image/png";
  if (!base64) {
    throw new GeminiGenerationError(
      "Gemini 応答に画像データなし（responseModalities 未対応モデル？）",
      502,
    );
  }
  return { buffer: Buffer.from(base64, "base64"), mime };
}

/**
 * Full end-to-end Gemini generation pipeline used by both the manual
 * /api/media/generate endpoint and the auto-attach fallback:
 *   1. Generate with Gemini
 *   2. Upload to user-media bucket
 *   3. Insert media_library row
 *
 * Quota check + counter increment is the caller's responsibility — the
 * manual endpoint already does its own quota response, and the
 * auto-attach helper increments after a successful save (this lets
 * fail-soft callers skip the increment when generation fails).
 */
export async function generateAiImageForUser(
  client: Client,
  userId: string,
  aiConfigId: string | null,
  prompt: string,
): Promise<MediaLibraryRow> {
  const { buffer, mime } = await callGeminiImage(prompt);
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  const ext = extForMime(mime);
  const id = randomUUID();
  const path = buildStoragePath(userId, aiConfigId, `${id}.${ext}`);

  const { publicUrl } = await uploadToUserMedia(client, path, blob, mime);

  const { data, error } = await client
    .from("media_library")
    .insert({
      user_id: userId,
      ai_config_id: aiConfigId,
      storage_path: path,
      public_url: publicUrl,
      source: "ai_generated",
      tags: [],
      ai_description: prompt,
      file_size_bytes: buffer.length,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new GeminiGenerationError(
      `media_library insert failed: ${error?.message ?? "unknown"}`,
      500,
    );
  }
  return data as MediaLibraryRow;
}
