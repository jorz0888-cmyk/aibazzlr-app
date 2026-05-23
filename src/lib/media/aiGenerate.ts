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
 * 2026-05-24 #A no-text-in-image fix.
 *
 * The previous version embedded the literal post body inside a
 * `Mood / caption context: "<JP text>"` line. Gemini reliably
 * interpreted the quoted JP text as "draw this caption" and produced
 * images with garbled kanji/hiragana baked in ("剽間です！" /
 * "SNS溍用" / etc.) — fatal for a SaaS shipping public X posts.
 *
 * The fix has 3 parts:
 *   1. The literal post body never enters the prompt. Topic tags +
 *      pillar concept words carry the semantic load; the body itself
 *      stays in the post caption where it belongs.
 *   2. A loud, structured "ABSOLUTE RULE — NO TEXT" block at the top
 *      of the prompt, listing every kind of writable surface to
 *      suppress (signs, screens, packaging, clothing, menus, etc.).
 *   3. Any JP keywords that DO have to appear (pillar name,
 *      hashtag-derived subject) are wrapped with "interpret as
 *      meaning, do NOT render as text in the image" so the model
 *      doesn't read them as transcription targets.
 *
 * `content` is still accepted in the signature for back-compat with
 * existing callers (and so a future change can use it as a private
 * input to a translation step) but it is NOT used in the returned
 * prompt — see explicit `void content` below.
 */
export function buildImagePromptFromPost(
  content: string,
  topicTags: string[],
  hashtags: string[],
  options: {
    pillar?: ContentPillar | null;
    /** Short, English-only concept summaries of recent images. See
     *  generateAiImageForUser for the new shape — we no longer feed
     *  back the full prompt (it used to re-inject the JP body). */
    recentImageDescriptions?: string[];
  } = {},
): string {
  void content; // intentionally unused — see jsdoc

  const semanticSubjects = [...topicTags, ...hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const parts: string[] = [];

  parts.push(
    "Generate a single photorealistic 4:5 vertical lifestyle photograph suitable for a Japanese small-business social post.",
  );

  // (2) Hard no-text instructions FIRST, before any keyword that
  //     might be interpreted as something to write.
  parts.push(
    "## ABSOLUTE RULE — NO TEXT OR WRITING IN THE IMAGE",
    "The image MUST NOT contain ANY of the following: text, letters, words, characters, kanji, hiragana, katakana, numbers, captions, subtitles, watermarks, logos, brand marks, UI elements, labels, speech bubbles, signage, billboards, posters, menus, receipts, business cards, t-shirt prints, book covers, document text, screen text on phones or computers, blackboard writing, neon signs, or any other readable mark.",
    "Every surface that could carry writing (signs, screens, posters, packaging, clothing, papers) must be blank, abstract, decorative, or out of focus.",
    "If you are uncertain whether something might be read as text, leave it out entirely. Wordless, text-free image.",
  );

  // (3) Semantic subject — wrap so the model treats keywords as
  //     concepts, not transcription targets.
  if (semanticSubjects.length > 0) {
    parts.push(
      "## Subject (interpret as visual concept, DO NOT render these words as text in the image)",
      semanticSubjects.join(", "),
    );
  } else {
    parts.push(
      "## Subject",
      "A warm everyday moment in a Japanese small business setting (cafe, workshop, atelier, salon, or workspace). No people facing the camera; environmental or hands-only shots preferred.",
    );
  }

  if (options.pillar) {
    parts.push(
      "## Angle (interpret as composition direction, DO NOT render the words)",
      `${options.pillar.name}: ${options.pillar.description}`,
    );
  }

  // Anti-similarity hint. recentImageDescriptions are now short
  // English summaries per the generateAiImageForUser change below,
  // so feeding them back doesn't re-inject JP text.
  const recent = (options.recentImageDescriptions ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (recent.length > 0) {
    parts.push(
      "## Past visual themes for this account (do NOT render these as text either)",
      recent.map((d, i) => `(${i + 1}) ${d.slice(0, 160)}`).join("; "),
      "The new image must be visually distinct from the past themes — different subject, composition, palette, or framing.",
    );
  }

  parts.push(
    "## Style",
    "Natural lighting, warm color palette, shallow depth of field, candid framing. No text, no logos, no watermarks, no UI overlays — repeating the rule because it is the most important constraint.",
  );

  return parts.join("\n");
}

/**
 * 2026-05-24 #A: build the SHORT, English-only summary stored in
 * media_library.ai_description. This is what gets fed back to the
 * NEXT image's anti-similarity hint, so it has to be safe to put
 * back into a Gemini prompt (no JP body, no risk of being mistaken
 * for transcription text).
 *
 * Keep it under ~120 chars and structured.
 */
function buildAiImageDescription(opts: {
  topicTags: string[];
  hashtags: string[];
  pillar?: ContentPillar | null;
}): string {
  const subjectKeys = [...opts.topicTags, ...opts.hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const pillar = opts.pillar?.name ?? "general";
  const parts: string[] = [
    `pillar=${pillar}`,
    subjectKeys ? `subjects=${subjectKeys}` : "subjects=general",
    "style=lifestyle-warm-natural",
  ];
  return parts.join(" / ").slice(0, 200);
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
  /**
   * 2026-05-24 #A: short English-only description to store in
   * media_library.ai_description. This value is fed back into the
   * NEXT image's anti-similarity hint, so it must be safe to put
   * into a Gemini prompt without triggering "draw this text"
   * behavior. Auto-attach builds it via buildAiImageDescription.
   *
   * When omitted (e.g. the manual /api/media/generate endpoint
   * where the user typed a free-text prompt), we fall back to a
   * truncated copy of the prompt — same as the pre-fix behavior.
   * Manual prompts are far less risky than auto-built ones
   * because the user is intentionally crafting them, but ideally
   * the manual endpoint would also pass a sanitized description.
   */
  description?: string,
): Promise<MediaLibraryRow> {
  const { buffer, mime } = await callGeminiImage(prompt);
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  const ext = extForMime(mime);
  const id = randomUUID();
  const path = buildStoragePath(userId, aiConfigId, `${id}.${ext}`);

  const { publicUrl } = await uploadToUserMedia(client, path, blob, mime);

  const safeDescription =
    description ?? prompt.replace(/[　-鿿]+/g, "").slice(0, 200);

  const { data, error } = await client
    .from("media_library")
    .insert({
      user_id: userId,
      ai_config_id: aiConfigId,
      storage_path: path,
      public_url: publicUrl,
      source: "ai_generated",
      tags: [],
      ai_description: safeDescription,
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

/**
 * Re-export so call sites can build the short description that
 * generateAiImageForUser stores (and that gets recycled into the next
 * image's anti-similarity hint).
 */
export { buildAiImageDescription };
