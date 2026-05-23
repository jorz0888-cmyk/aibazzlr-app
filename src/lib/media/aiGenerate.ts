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
 * 2026-05-24 image-style variants (per quality review).
 *
 * The previous version baked a single "warm natural lifestyle" style
 * into every image (palette + composition + subject hint hardcoded
 * at the bottom of the prompt, plus a fixed style=lifestyle-warm-
 * natural tag in the description). All 8 pillars then produced the
 * same beige-cafe-young-woman aesthetic — same tone forever.
 *
 * Now we keep 4 visually distinct presets and map each pillar
 * deterministically to one via FNV-1a hash on pillar.id. Same
 * pillar → same style every time (so a pillar feels consistent
 * across its own posts), but the 8 pillars distribute across the 4
 * presets and the feed gets visibly varied.
 *
 * Subject framing inside each preset deliberately avoids any single
 * demographic default: "if a person appears, vary age/gender —
 * never default to a young woman", and several presets prefer
 * people-free still-life / hands-only / environmental shots.
 *
 * Hard rule (unchanged from earlier #A fix): every variant uses the
 * SAME no-text instruction block at the top of the prompt. Style
 * only swaps palette / composition / subject framing.
 */
const IMAGE_STYLE_VARIANTS = {
  "warm-natural": {
    palette:
      "Warm earth tones, soft natural daylight from a window, beige / amber / honey accents",
    composition:
      "Candid lifestyle framing, slightly soft focus, intimate close-to-medium shot",
    subjectHint:
      "Cozy domestic, cafe, or sunlit-room setting. Strongly prefer still-life (a cup on a table, a notebook with a hand on it, an open window, indoor plants) over portraits. If a person does appear, vary age (could be 20s through 60s) and gender across images — explicitly do NOT default to a young woman.",
  },
  "clean-minimal": {
    palette:
      "White or light-grey background, soft shadows, a single accent color (could be muted blue, sage, or terracotta — vary across images)",
    composition:
      "Studio-style centered single subject or symmetric flat-lay, generous negative space, very sharp focus, no human figures",
    subjectHint:
      "A single object or small grouping on a clean surface — a folded notebook, a pen, a single fruit, a small ceramic dish, a smartphone face-down. No people at all. Quiet, almost editorial feel.",
  },
  "energetic-bright": {
    palette:
      "High saturation, bold mid-day daylight, contrasting accent colors (vary which color leads across images — could be vivid green, deep red, or saturated blue)",
    composition:
      "Dynamic angle (low-angle, Dutch tilt, or overhead 3/4), subtle motion blur in foreground or background, more visual energy",
    subjectHint:
      "Outdoor street or seasonal scene, vivid food shot, weather / sky element, a moment of action (rain on pavement, steam rising from a cup, leaves in motion). Avoid signage and neon since they tend to carry text. If a person appears, only show movement or back-of-head — never full face — and vary their attire and age.",
  },
  "professional-workspace": {
    palette:
      "Neutral cool tones, controlled even daylight, navy / slate / muted grey accents, occasional warm wood",
    composition:
      "Structured composition, sharp focus, slight overhead or 3/4-overhead angle, organized framing",
    subjectHint:
      "Workspace stillness — a closed laptop, an open notebook with a pen across it, a coffee mug, a small succulent on a desk. If a person appears, show only hands on a keyboard or pen — never a face. Vary the visible clothing (sweater / button-down / casual) across images so it doesn't read as the same person.",
  },
} as const;

type ImageStyleKey = keyof typeof IMAGE_STYLE_VARIANTS;
const IMAGE_STYLE_KEYS = Object.keys(
  IMAGE_STYLE_VARIANTS,
) as ImageStyleKey[];

/**
 * Deterministic mapping pillar.id → style. FNV-1a 32-bit hash mod 4
 * gives a stable assignment that doesn't drift if a pillar's name
 * is renamed (the id stays the same; see pillars.ts slugifyPillarName).
 *
 * If pillar is missing, we fall back to hashing the first topic tag
 * or hashtag so different posts in the same config still get
 * different styles. As a last resort we hash the literal "default"
 * which always lands on the same variant — fine, it only affects
 * the cold-start case where a config has no pillars and no topics.
 */
function styleKeyForPillar(
  pillarId: string | null | undefined,
  fallbackSeed: string,
): ImageStyleKey {
  const seed = (pillarId || fallbackSeed || "default").trim() || "default";
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return IMAGE_STYLE_KEYS[h % IMAGE_STYLE_KEYS.length];
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

  // 2026-05-24 style-variants: pick palette / composition / subject
  // framing based on pillar. NO-TEXT block below is unchanged.
  const styleKey = styleKeyForPillar(
    options.pillar?.id ?? null,
    topicTags[0] ?? hashtags[0] ?? "default",
  );
  const style = IMAGE_STYLE_VARIANTS[styleKey];

  const parts: string[] = [];

  parts.push(
    "Generate a single photorealistic 4:5 vertical lifestyle photograph suitable for a Japanese small-business social post.",
  );

  // (2) Hard no-text instructions FIRST, before any keyword that
  //     might be interpreted as something to write.
  //     ↓ DO NOT REMOVE OR WEAKEN — text-glyph fix from earlier #A.
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
  }

  // Variant-specific subject framing. Always added (replaces the
  // old hardcoded "warm everyday moment in a Japanese small
  // business setting" default that was forcing a single aesthetic).
  parts.push("## Subject framing", style.subjectHint);

  if (options.pillar) {
    parts.push(
      "## Angle (interpret as composition direction, DO NOT render the words)",
      `${options.pillar.name}: ${options.pillar.description}`,
    );
  }

  // Anti-similarity hint. recentImageDescriptions are now short
  // English summaries per the generateAiImageForUser change below,
  // so feeding them back doesn't re-inject JP text. The encoded
  // style=<variant> token inside each past description also helps
  // Gemini diverge from the previous style.
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

  // Variant-specific style. Closes with a no-text reminder because
  // it is the single most-violated constraint in our test runs.
  parts.push(
    "## Style",
    `Palette: ${style.palette}.`,
    `Composition: ${style.composition}.`,
    "No text, no logos, no watermarks, no UI overlays anywhere in the image — repeating the most important constraint.",
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
  // 2026-05-24 style-variants: encode the actual variant we used.
  // The previous hard-coded "lifestyle-warm-natural" string here made
  // every description claim the same style even when we varied — and
  // also fed that single style label back into the next image's
  // anti-similarity hint, reinforcing the monochrome look.
  const styleKey = styleKeyForPillar(
    opts.pillar?.id ?? null,
    opts.topicTags[0] ?? opts.hashtags[0] ?? "default",
  );
  const parts: string[] = [
    `pillar=${pillar}`,
    subjectKeys ? `subjects=${subjectKeys}` : "subjects=general",
    `style=${styleKey}`,
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
