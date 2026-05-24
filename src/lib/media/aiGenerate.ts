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
/**
 * 2026-05-24 #C-2: each style is now (palette + composition) tone
 * direction PLUS a subjectPool of distinct scenes. Per generation
 * we pick ONE pool entry — not all of them — so the same style
 * doesn't keep painting "laptop + mug + plant" forever. The picked
 * entry's slug is encoded into ai_description so the next image's
 * anti-similarity hint sees which scenes were just used.
 *
 * Mix of with-people / no-people / hands-only / environmental per
 * style, so within a single style we still vary subject type.
 */
const IMAGE_STYLE_VARIANTS = {
  "warm-natural": {
    palette:
      "Warm earth tones, soft natural daylight from a window, beige / amber / honey accents",
    composition:
      "Candid lifestyle framing, slightly soft focus, intimate close-to-medium shot",
    subjectPool: [
      {
        slug: "wn-cup-window",
        scene:
          "A single ceramic cup of tea or coffee on a wooden table near a sunlit window, no people, soft window light, steam barely visible.",
      },
      {
        slug: "wn-hands-notebook",
        scene:
          "Close-up on hands of an indeterminate adult (age 30s-60s, vary gender each generation) writing in a paper notebook by warm morning light. Face out of frame. Sleeve color varies — knit / linen / chambray.",
      },
      {
        slug: "wn-windowsill-plant",
        scene:
          "A potted plant on a windowsill with curtain shadows falling across a wall behind. Pure still life, no people. Pot material varies between terracotta, glazed ceramic, or wood.",
      },
      {
        slug: "wn-floor-corner",
        scene:
          "A quiet floor-level corner of a room — slippers and a folded throw blanket on a hardwood floor, half a chair leg visible, slanted window light. No people in frame.",
      },
      {
        slug: "wn-book-chair",
        scene:
          "An open book lying face down on a rattan or upholstered chair, a small side table with a cup, late afternoon golden light, no people.",
      },
      {
        slug: "wn-breakfast-counter",
        scene:
          "A simple breakfast on a kitchen counter — bowl with fruit, a glass of water, a folded cloth napkin — flat-ish angle. No person visible.",
      },
      {
        slug: "wn-back-window-figure",
        scene:
          "A back-view of a single person standing by a window looking out, age and gender unspecified (please vary). Soft silhouette against bright outside light. No face visible.",
      },
    ],
  },
  "clean-minimal": {
    palette:
      "White or light-grey background, soft shadows, a single accent color (could be muted blue, sage, or terracotta — vary across images)",
    composition:
      "Studio-style centered single subject or symmetric flat-lay, generous negative space, very sharp focus, no human figures",
    subjectPool: [
      {
        slug: "cm-folded-notebook",
        scene:
          "A single closed notebook centered on a clean white surface, a small accent (a pen or paperclip) placed beside it. Editorial flat-lay overhead view.",
      },
      {
        slug: "cm-single-fruit",
        scene:
          "A single piece of fruit (lemon, apple, persimmon — vary) on a plain pale surface, centered, soft directional shadow.",
      },
      {
        slug: "cm-ceramic-dish",
        scene:
          "An empty small ceramic dish or bowl on white surface, centered, almost architectural. No food, no people.",
      },
      {
        slug: "cm-pencil-eraser",
        scene:
          "A single mechanical pencil and a small geometric eraser arranged on a clean off-white surface. Top-down composition with negative space.",
      },
      {
        slug: "cm-folded-cloth",
        scene:
          "A neatly folded cotton cloth or linen napkin on a clean surface, accent color folded inward. Almost wabi-sabi simplicity.",
      },
      {
        slug: "cm-phone-down",
        scene:
          "A smartphone laid face-down on a white surface, no visible screen, with one small accent object (a coin / small stone / leaf) beside it. Editorial spacing.",
      },
      {
        slug: "cm-glass-water",
        scene:
          "A single glass of water on a clean light grey surface, condensation visible, soft side lighting. Pure still life.",
      },
    ],
  },
  "energetic-bright": {
    palette:
      "High saturation, bold mid-day daylight, contrasting accent colors (vary which color leads across images — could be vivid green, deep red, or saturated blue)",
    composition:
      "Dynamic angle (low-angle, Dutch tilt, or overhead 3/4), subtle motion blur in foreground or background, more visual energy",
    subjectPool: [
      {
        slug: "eb-steam-cup",
        scene:
          "Strong overhead light catching steam rising from a hot cup, dark surface beneath, dramatic contrast. No text, no logos. Object-only.",
      },
      {
        slug: "eb-leaves-motion",
        scene:
          "Autumn or summer leaves caught mid-fall against a bright sky, slight motion blur. Pure nature shot, no people.",
      },
      {
        slug: "eb-rain-pavement",
        scene:
          "Rain on dark city pavement seen from a low angle, reflected colored light from above (could be sunset or storefront glow). No legible signage. No faces.",
      },
      {
        slug: "eb-vivid-food",
        scene:
          "A vibrant single-dish food shot — colorful salad / fresh fruit bowl / curry / ramen — top-down with one bright accent. Plate or bowl varies (white ceramic, dark stoneware, lacquer).",
      },
      {
        slug: "eb-back-walking",
        scene:
          "A back-view of a person walking quickly through a colorful environment — could be a market, a plaza, a station — motion blur on background. Attire varies (suit, casual, coat). No face visible.",
      },
      {
        slug: "eb-cyclist-blur",
        scene:
          "A blurred cyclist passing through a bright outdoor scene, panning blur on background. Pure motion shot, no readable text on storefronts behind.",
      },
      {
        slug: "eb-sky-window",
        scene:
          "A dramatic sky photographed through a wide window — dawn, sunset, or storm — no horizon line cluttered with signage. Object-only.",
      },
    ],
  },
  "professional-workspace": {
    palette:
      "Neutral cool tones, controlled even daylight, navy / slate / muted grey accents, occasional warm wood",
    composition:
      "Structured composition, sharp focus, slight overhead or 3/4-overhead angle, organized framing",
    subjectPool: [
      {
        slug: "pw-desk-overhead",
        scene:
          "Overhead view of an organized desk — closed laptop, a notebook, a pen, a coffee mug. Vary the laptop's color (silver / dark / matte) and surrounding accents (succulent or plain). No screen content visible.",
      },
      {
        slug: "pw-hands-keyboard",
        scene:
          "Close-up on hands of an indeterminate adult typing on a keyboard. Vary visible cuff color (sweater knit / button-down / casual). No face, no screen text visible.",
      },
      {
        slug: "pw-meeting-table",
        scene:
          "An empty conference / meeting table with two coffee cups and a small notebook left behind, soft daylight from a side window. No people, no logos on cups.",
      },
      {
        slug: "pw-office-space",
        scene:
          "Wide architectural shot of a clean, modern office room — empty chairs, a long table, neutral palette — no people present, no readable text on walls or whiteboards (whiteboards completely blank).",
      },
      {
        slug: "pw-tools-flatlay",
        scene:
          "Flat-lay of work tools — wired headphones coiled, a stack of notebooks, a fountain pen, a closed laptop — overhead, structured grid composition. No screen visible.",
      },
      {
        slug: "pw-window-view",
        scene:
          "A window view from a quiet office — buildings or trees outside, an empty chair foreground, neutral interior tones, weather-soft light. No people.",
      },
      {
        slug: "pw-coffee-pour",
        scene:
          "Side angle of coffee being poured from a stainless server into a plain mug on a clean desk surface. Hand visible only briefly, no face. No barista signage.",
      },
    ],
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
 * 2026-05-24 #C-2: pick ONE subjectPool entry per image generation.
 *
 * Biased away from slugs that appear in recent descriptions (so back-
 * to-back posts in the same style don't keep landing on the same
 * scene). If every pool entry is recently used, fall back to pure
 * random over the full pool.
 *
 * Returns both the long scene description (for the prompt) and the
 * short slug (for ai_description, which feeds the next call's anti-
 * similarity hint).
 */
function pickPoolEntry(
  pool: ReadonlyArray<{ slug: string; scene: string }>,
  recentDescriptions: string[],
): { slug: string; scene: string } {
  if (pool.length === 0) {
    return { slug: "fallback", scene: "Generic lifestyle scene." };
  }
  const recentBlob = recentDescriptions.join(" ").toLowerCase();
  const unused = pool.filter(
    (entry) => !recentBlob.includes(entry.slug.toLowerCase()),
  );
  const candidates = unused.length > 0 ? unused : pool;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
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

  // 2026-05-24 #C-2: pick ONE specific scene from the style's pool.
  // Bias away from slugs found in the past 5 descriptions so same-
  // style consecutive posts don't render the same scene.
  const pickedScene = pickPoolEntry(
    style.subjectPool,
    options.recentImageDescriptions ?? [],
  );

  const parts: string[] = [];

  parts.push(
    "Generate a single photorealistic 4:5 vertical lifestyle photograph suitable for a Japanese small-business social post.",
  );

  // (2) Hard no-text instructions FIRST, before any keyword that
  //     might be interpreted as something to write.
  //     ↓ DO NOT REMOVE OR WEAKEN — text-glyph fix from earlier #A.
  parts.push(
    "## ABSOLUTE RULE — NO TEXT, DIAGRAMS, OR INFORMATIONAL GRAPHICS IN THE IMAGE",
    "The image MUST NOT contain ANY of the following: text, letters, words, characters, kanji, hiragana, katakana, numbers, captions, subtitles, watermarks, logos, brand marks, UI elements, labels, speech bubbles, signage, billboards, posters, menus, receipts, business cards, t-shirt prints, book covers, document text, screen text on phones or computers, blackboard writing, neon signs, or any other readable mark.",
    "Also forbidden: diagrams, flowcharts, charts, graphs, schematic drawings, blueprints, maps, UI mockups, app interfaces, dashboards, circuit diagrams, circuit boards, circuit-trace patterns, PCBs, block diagrams, network or node-and-edge drawings, mind maps, org charts, infographics, wall graphics depicting connected shapes, arrows linking boxes, abstract symbolic illustrations, icons, pictograms, or any drawn lines that imply meaning. Any technical or informational graphic of any kind is prohibited — the image must be purely photographic, real-world content only.",
    "Every surface that could carry writing OR diagrams (signs, screens, posters, packaging, clothing, papers, walls, whiteboards, blackboards, notebooks shown open) must be blank, naturally textured (wood grain / fabric weave / paper fiber), or fully out of focus. 'Decorative pattern' is NOT acceptable as a fallback — even abstract patterns can read as circuits, UI, or maps. Default to a plain real-world surface.",
    "Screens and displays specifically (laptop / tablet / phone / TV / monitor / dashboard / smartwatch): must be POWERED OFF (dark glass with a faint reflection), or COMPLETELY BLACK, or so heavily out of focus they read as a single dark surface. Never show a UI, app, icon, button, dashboard, chart, circuit pattern, PCB layout, wallpaper, or any drawn content on a screen — regardless of style preset.",
    "Photographic, naturalistic visuals only. No symbolic, schematic, or diagrammatic content of any kind. If you are uncertain whether something might be read as text or as a diagram, leave it out entirely.",
  );

  // (3) Semantic subject — wrap so the model treats keywords as
  //     concepts, not transcription targets.
  if (semanticSubjects.length > 0) {
    parts.push(
      "## Subject (interpret as visual concept, DO NOT render these words as text in the image)",
      semanticSubjects.join(", "),
    );
  }

  // Variant-specific subject framing. One scene picked per call from
  // the style's pool — see pickPoolEntry above. This is what fixes
  // the "every professional-workspace image is laptop+mug+plant"
  // collapse: same style across posts, different scene per post.
  parts.push("## Specific scene to draw", pickedScene.scene);

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
 * 2026-05-24 #C-2: composite builder that returns BOTH the Gemini
 * prompt AND the chosen scene slug + style key. autoSelect uses the
 * slug as the `scene=` field in ai_description so the next image's
 * anti-similarity hint sees which pool entries were just used.
 *
 * Replaces the pattern where caller had to call buildImagePromptFromPost
 * then re-run the picker for the description — which broke because
 * Math.random() returned a different choice the second time.
 */
export function buildImagePromptAndChoice(
  content: string,
  topicTags: string[],
  hashtags: string[],
  options: {
    pillar?: ContentPillar | null;
    recentImageDescriptions?: string[];
  } = {},
): { prompt: string; styleKey: ImageStyleKey; sceneSlug: string } {
  const styleKey = styleKeyForPillar(
    options.pillar?.id ?? null,
    topicTags[0] ?? hashtags[0] ?? "default",
  );
  const sceneSlug = pickPoolEntry(
    IMAGE_STYLE_VARIANTS[styleKey].subjectPool,
    options.recentImageDescriptions ?? [],
  ).slug;
  // buildImagePromptFromPost re-runs the picker internally; since
  // it's same-process and we already chose, we can't perfectly pin
  // the picker. To keep this race-free, we re-implement the prompt
  // build inline here using our pre-chosen scene.
  const style = IMAGE_STYLE_VARIANTS[styleKey];
  const scene =
    style.subjectPool.find((p) => p.slug === sceneSlug)?.scene ??
    style.subjectPool[0]?.scene ??
    "";

  void content;
  const semanticSubjects = [...topicTags, ...hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const parts: string[] = [
    "Generate a single photorealistic 4:5 vertical lifestyle photograph suitable for a Japanese small-business social post.",
    // ↓ DO NOT REMOVE OR WEAKEN — text-glyph fix from earlier #A.
    "## ABSOLUTE RULE — NO TEXT, DIAGRAMS, OR INFORMATIONAL GRAPHICS IN THE IMAGE",
    "The image MUST NOT contain ANY of the following: text, letters, words, characters, kanji, hiragana, katakana, numbers, captions, subtitles, watermarks, logos, brand marks, UI elements, labels, speech bubbles, signage, billboards, posters, menus, receipts, business cards, t-shirt prints, book covers, document text, screen text on phones or computers, blackboard writing, neon signs, or any other readable mark.",
    "Also forbidden: diagrams, flowcharts, charts, graphs, schematic drawings, blueprints, maps, UI mockups, app interfaces, dashboards, circuit diagrams, circuit boards, circuit-trace patterns, PCBs, block diagrams, network or node-and-edge drawings, mind maps, org charts, infographics, wall graphics depicting connected shapes, arrows linking boxes, abstract symbolic illustrations, icons, pictograms, or any drawn lines that imply meaning. Any technical or informational graphic of any kind is prohibited — the image must be purely photographic, real-world content only.",
    "Every surface that could carry writing OR diagrams (signs, screens, posters, packaging, clothing, papers, walls, whiteboards, blackboards, notebooks shown open) must be blank, naturally textured (wood grain / fabric weave / paper fiber), or fully out of focus. 'Decorative pattern' is NOT acceptable as a fallback — even abstract patterns can read as circuits, UI, or maps. Default to a plain real-world surface.",
    "Screens and displays specifically (laptop / tablet / phone / TV / monitor / dashboard / smartwatch): must be POWERED OFF (dark glass with a faint reflection), or COMPLETELY BLACK, or so heavily out of focus they read as a single dark surface. Never show a UI, app, icon, button, dashboard, chart, circuit pattern, PCB layout, wallpaper, or any drawn content on a screen — regardless of style preset.",
    "Photographic, naturalistic visuals only. No symbolic, schematic, or diagrammatic content of any kind. If you are uncertain whether something might be read as text or as a diagram, leave it out entirely.",
  ];
  if (semanticSubjects.length > 0) {
    parts.push(
      "## Subject (interpret as visual concept, DO NOT render these words as text in the image)",
      semanticSubjects.join(", "),
    );
  }
  parts.push("## Specific scene to draw", scene);
  if (options.pillar) {
    parts.push(
      "## Angle (interpret as composition direction, DO NOT render the words)",
      `${options.pillar.name}: ${options.pillar.description}`,
    );
  }
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
    `Palette: ${style.palette}.`,
    `Composition: ${style.composition}.`,
    "No text, no logos, no watermarks, no UI overlays anywhere in the image — repeating the most important constraint.",
  );

  return { prompt: parts.join("\n"), styleKey, sceneSlug };
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
  /** 2026-05-24 #C-2: the scene slug actually chosen by the picker.
   *  Encoded as scene=<slug> so anti-similarity feedback can dodge
   *  it. Caller passes the value returned by buildImagePromptAndChoice. */
  sceneSlug?: string;
  /** 2026-05-24 #C-2: style key actually chosen. Same source. */
  styleKey?: ImageStyleKey;
}): string {
  const subjectKeys = [...opts.topicTags, ...opts.hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const pillar = opts.pillar?.name ?? "general";
  const styleKey =
    opts.styleKey ??
    styleKeyForPillar(
      opts.pillar?.id ?? null,
      opts.topicTags[0] ?? opts.hashtags[0] ?? "default",
    );
  const parts: string[] = [
    `pillar=${pillar}`,
    subjectKeys ? `subjects=${subjectKeys}` : "subjects=general",
    `style=${styleKey}`,
  ];
  if (opts.sceneSlug) parts.push(`scene=${opts.sceneSlug}`);
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
