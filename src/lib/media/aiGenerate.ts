import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type {
  AiConfig,
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
 *
 * 2026-05-24 #G1: subjectPool here is NO LONGER USED for the
 * primary scene choice. Style presets now contribute only palette
 * and composition; the scene comes from PILLAR_SCENE_CATEGORIES
 * below, which maps the post's pillar to a business-neutral scene
 * pool. subjectPool is kept on the type for legacy safety only —
 * pickPoolEntry is no longer called against it from the builders.
 */
const IMAGE_STYLE_VARIANTS = {
  "warm-natural": {
    palette:
      "Soft natural daylight from a window, neutral warm tones with subtle understated accents (beige / soft sand / muted clay) — keep accents restrained so the image does not read as season-locked",
    composition:
      "Candid working-moment framing, intimate close-to-medium shot",
    subjectPool: [
      {
        slug: "wn-cup-window",
        scene:
          "A single ceramic cup of tea or coffee on a wooden table near a sunlit window, no people, soft window light, steam barely visible.",
      },
      {
        slug: "wn-hands-notebook",
        scene:
          "Close-up on hands of an indeterminate adult (age 30s-60s, vary gender each generation) writing in a paper notebook by soft natural morning light. Face out of frame. Sleeve fabric varies — linen / cotton / chambray.",
      },
      {
        slug: "wn-windowsill-plant",
        scene:
          "A potted plant on a windowsill with curtain shadows falling across a wall behind. Pure still life, no people. Pot material varies between terracotta, glazed ceramic, or wood.",
      },
      {
        slug: "wn-floor-corner",
        scene:
          "A quiet floor-level corner of a room — slippers and a folded light cloth on a hardwood floor, half a chair leg visible, slanted window light. No people in frame.",
      },
      {
        slug: "wn-book-chair",
        scene:
          "An open book lying face down on a rattan or upholstered chair, a small side table with a cup, soft natural daylight, no people.",
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
      "Studio-style centered single subject or symmetric flat-lay, balanced composition, sharp focus",
    subjectPool: [
      {
        slug: "cm-folded-notebook",
        scene:
          "A single closed notebook centered on a clean white surface, a small accent (a pen or paperclip) placed beside it. Editorial flat-lay overhead view.",
      },
      {
        slug: "cm-single-fruit",
        scene:
          "A single piece of fruit (lemon, apple, or pear — vary) on a plain pale surface, centered, soft directional shadow.",
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
          "A neatly folded cotton cloth or linen napkin on a clean surface, accent color folded inward.",
      },
      {
        slug: "cm-phone-down",
        scene:
          "A smartphone laid face-down on a white surface, no visible screen, with one small accent object (a coin / small stone / pebble) beside it. Editorial spacing.",
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
          "Leaves caught mid-fall against a bright sky, slight motion blur. Pure nature shot, no people. Use foliage appropriate to the current season — do not default to autumn coloration.",
      },
      {
        slug: "eb-rain-pavement",
        scene:
          "Rain on dark city pavement seen from a low angle, reflected colored light from above (storefront glow or street lamps). No legible signage. No faces.",
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
          "A sky photographed through a wide window — bright midday or soft morning — no horizon line cluttered with signage. Object-only.",
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
          "Close-up on hands of an indeterminate adult typing on a keyboard. Vary visible cuff fabric (button-down / casual / lightweight cotton). No face, no screen text visible.",
      },
      {
        slug: "pw-meeting-table",
        scene:
          "A conference / meeting table with two people working across from each other in soft daylight from a side window, coffee cups and a small notebook on the table. Faces partial or in profile. No logos on cups.",
      },
      {
        slug: "pw-office-space",
        scene:
          "Wide architectural shot of a clean, modern office room with one or two people working at the long table, neutral palette. No readable text on walls or whiteboards (whiteboards completely blank). Faces partial or backs to the camera.",
      },
      {
        slug: "pw-tools-flatlay",
        scene:
          "Flat-lay of work tools — wired headphones coiled, a stack of notebooks, a fountain pen, a closed laptop — overhead, structured grid composition. No screen visible.",
      },
      {
        slug: "pw-window-view",
        scene:
          "A window view from a quiet office — buildings or trees outside, a person standing or seated in the foreground (back view, no face visible), neutral interior tones, weather-soft light.",
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
 * 2026-05-24 #G1 — pillar → business-neutral scene categories.
 *
 * Replaces the previous "style preset decides the scene" coupling.
 * The previous design mapped pillar.id → FNV hash → one of 4 style
 * presets, and each style preset had a fixed subjectPool of decorative
 * lifestyle still-lifes (folded notebook, phone-down, coffee pour,
 * etc). Result: a "comment reply" post got a "folded notebook" image
 * — visually fine but with zero connection to the post's claim.
 *
 * New flow: pillar.name + pillar.description are keyword-matched to a
 * SCENE CATEGORY. Each category has 6-7 SCENE TEMPLATES describing the
 * *type* of moment to capture (owner's hands at central work / shop
 * before opening / customer handoff / etc), kept INDUSTRY-NEUTRAL so
 * the same templates fit a florist, a salon, a yoga studio, or a
 * software product equally. Industry-specific skin is supplied by the
 * G2 "## Business context" section above; the scene template provides
 * the structural angle.
 *
 * Every scene below:
 *   - is a real-world photographic moment (no text, no UI, no screens,
 *     no diagrams, no signage with readable letters — defended by the
 *     ABSOLUTE RULE block above);
 *   - uses generic role words (owner / customer / workshop / counter)
 *     so Gemini fills in the visual from the business context, not
 *     from the scene template;
 *   - prefers hands / back-views / three-quarter profiles so the
 *     image carries activity without locking faces or identities.
 */
type SceneEntry = { slug: string; scene: string };
type SceneCategory = {
  slug: string;
  /** Substrings searched (case-insensitive) inside pillar.name +
   *  pillar.description. First-highest-score wins. */
  keywords: string[];
  scenes: SceneEntry[];
};

const PILLAR_SCENE_CATEGORIES: SceneCategory[] = [
  {
    slug: "customer_relationship",
    keywords: [
      "コメント",
      "返信",
      "DM",
      "ファン",
      "フォロワー",
      "距離",
      "関係",
      "親密",
      "信頼",
      "接客",
      "対人",
      "リピーター",
      "ロイヤ",
      "コミュニケ",
    ],
    scenes: [
      {
        slug: "cr-handoff-close",
        scene:
          "Close-up of two adults' hands meeting across a counter as something small (a package, a card, a small item) changes hands. Both hands visible, faces out of frame. Indoor soft daylight.",
      },
      {
        slug: "cr-bow-doorway",
        scene:
          "Owner's back view at a storefront doorway making a small polite bow as a customer's silhouette steps outside. Quiet polite moment, no readable signage anywhere.",
      },
      {
        slug: "cr-counter-listen",
        scene:
          "Owner leaning over a counter in three-quarter profile listening to a customer also in three-quarter profile across from them, neither facing the camera. Side-window daylight.",
      },
      {
        slug: "cr-pointing-product",
        scene:
          "Owner's hand pointing toward a feature of a product or display, a customer's elbow visible at the edge of the frame implying conversation. Indoor working tone.",
      },
      {
        slug: "cr-handwritten-card",
        scene:
          "Owner's hand placing a small handwritten note beside a wrapped item on a counter. Handwriting is intentionally out of focus — no characters legible.",
      },
      {
        slug: "cr-doorway-wave",
        scene:
          "Owner's back view at the storefront entrance giving a small wave to a customer walking down the street outside. Soft outdoor light.",
      },
      {
        slug: "cr-tying-ribbon",
        scene:
          "Two hands carefully tying a ribbon around a small wrapped product on a counter. Calm patient gesture. No readable text on packaging.",
      },
    ],
  },
  {
    slug: "mindset_continuation",
    keywords: [
      "マインド",
      "続け",
      "続か",
      "継続",
      "習慣",
      "やる気",
      "心理",
      "モチベ",
      "疲れ",
      "壁",
      "挫折",
      "メンタル",
      "コツコツ",
    ],
    scenes: [
      {
        slug: "mc-repeat-task",
        scene:
          "Owner's hands repeating a small daily task mid-motion — folding cloths, arranging tools, wiping a surface. Indoor working light, face out of frame, suggests routine.",
      },
      {
        slug: "mc-shutter-open",
        scene:
          "Wide shot of an owner from behind opening a shop shutter or arranging a storefront at the start of the day, soft early-morning light.",
      },
      {
        slug: "mc-pause-breath",
        scene:
          "Owner mid-work pausing — hands resting on a worktop, a quiet exhale posture, three-quarter side profile, eyes downward. Face partial only.",
      },
      {
        slug: "mc-row-of-prep",
        scene:
          "A neatly aligned row of identical hand-prepared items on a worktop (bottles, containers, small packages), slight overhead angle. Suggests daily ritual, no readable text on items.",
      },
      {
        slug: "mc-walk-through",
        scene:
          "Owner walking through an empty backroom or workshop carrying tools or stock at the start of the day, back view, soft early light.",
      },
      {
        slug: "mc-tool-from-rack",
        scene:
          "Hands lifting a piece of equipment from a hook or rack on a working wall, mid-routine reach. Indoor tone, no readable labels.",
      },
      {
        slug: "mc-tired-focus",
        scene:
          "Owner mid-task captured in three-quarter side profile only, focused expression, no eye contact with camera. Working ambient light.",
      },
    ],
  },
  {
    slug: "ai_meta_behind_scenes",
    keywords: [
      "AI",
      "舞台裏",
      "メタ",
      "プロンプト",
      "自動",
      "プロセス",
      "仕組み",
      "裏側",
      "実演",
      "メイキング",
    ],
    scenes: [
      {
        slug: "am-cards-corkboard",
        scene:
          "Owner's hands pinning small physical reference cards on a corkboard. Cards are blurred or facing away — no readable text. Working light.",
      },
      {
        slug: "am-workshop-shelves",
        scene:
          "Backroom or workshop view: shelves of materials and tools that compose a daily craft, calm in-process atmosphere, no people. Indoor light.",
      },
      {
        slug: "am-pencil-checklist",
        scene:
          "Owner's hand making a small mark on a paper checklist with a pencil, close-up on wrist and pencil tip. Page content intentionally blurred — no readable lines.",
      },
      {
        slug: "am-workbench-back",
        scene:
          "Wide shot of an owner from behind at a workbench mid-task, surrounded by tools of the trade. Process visible without revealing a face.",
      },
      {
        slug: "am-craft-in-progress",
        scene:
          "Close-up of a craft in progress — a partial assembly, materials laid out — captured at the moment of decision-making. Hands present, no face.",
      },
      {
        slug: "am-plan-objects",
        scene:
          "Daylight on a tidy work table where the day's plan has been laid out as physical objects — tools, materials, a closed notebook. No people, no readable text.",
      },
      {
        slug: "am-equipment-adjust",
        scene:
          "Owner's two hands carefully adjusting a piece of equipment, focused care. Indoor working light, no UI visible.",
      },
    ],
  },
  {
    slug: "trend_seasonal",
    keywords: [
      "季節",
      "トレンド",
      "時事",
      "イベント",
      "シーズン",
      "話題",
      "旬",
    ],
    scenes: [
      {
        slug: "ts-decoration-adjust",
        scene:
          "Owner adjusting a small seasonal decoration at the storefront entrance — decoration shape only, no readable characters on it. Quiet mid-task posture.",
      },
      {
        slug: "ts-seasonal-material",
        scene:
          "Close-up of hands working with materials appropriate to the current season at a counter (fabric, ingredient, container — kept abstract). Soft natural light.",
      },
      {
        slug: "ts-entrance-light",
        scene:
          "Wide shot of a storefront entrance with the current season's light pattern falling across it. Owner's back partially visible inside.",
      },
      {
        slug: "ts-hold-item",
        scene:
          "Hands holding a single seasonal item up to the light to inspect its texture. No text on the item, indoor working tone.",
      },
      {
        slug: "ts-display-monthly",
        scene:
          "A display of products arranged to reflect the current month's feel — color choices restrained, no readable labels.",
      },
      {
        slug: "ts-doorway-season",
        scene:
          "Owner standing in the open doorway looking out at the season, three-quarter profile. Light appropriate to the current month.",
      },
    ],
  },
  {
    slug: "data_metrics",
    keywords: [
      "数字",
      "データ",
      "分析",
      "指標",
      "解析",
      "計測",
      "効果測定",
      "KPI",
      "成果",
    ],
    scenes: [
      // ★ #A constraint: NO charts / dashboards / graphs / screens with
      //   any UI. Use physical volume, arrangement, repetition as
      //   visual stand-ins for "looking at the numbers".
      {
        slug: "dm-grid-inventory",
        scene:
          "Overhead shot of identical small items lined up in a grid — a physical inventory ready for counting. Hands visible at the edge sliding one into place.",
      },
      {
        slug: "dm-shelf-distance",
        scene:
          "Owner standing back from a long shelf or rack of products, evaluating the lineup from a distance. Back view, soft daylight.",
      },
      {
        slug: "dm-tally-touch",
        scene:
          "Close-up of hands tallying physical items by touch — stacking coins, sorting tags, arranging on a tray. Items blurred, no readable numbers anywhere.",
      },
      {
        slug: "dm-two-piles",
        scene:
          "Wide shot of two adjacent piles or arrangements that subtly differ in volume — one larger, one smaller — visual contrast of quantity without any chart. Indoor working light.",
      },
      {
        slug: "dm-stocktake-bend",
        scene:
          "Owner mid-stocktake bending over a tray, hands counting by touch, face out of frame. Soft daylight.",
      },
      {
        slug: "dm-row-fullness",
        scene:
          "A row of identical containers, three noticeably fuller than the others, pure object composition, no people, no text.",
      },
    ],
  },
  {
    slug: "industry_specific_tips",
    keywords: [
      "業種",
      "業界",
      "店舗",
      "サロン",
      "美容",
      "飲食",
      "小売",
      "業態",
    ],
    scenes: [
      {
        slug: "is-central-work",
        scene:
          "Close-up of the owner's central daily work — the single defining action of this business — done with both hands in focused care. Indoor working light.",
      },
      {
        slug: "is-storefront",
        scene:
          "Wide shot of a storefront or workspace exterior during working hours, soft daylight on the equipment that signals this business kind. Signage shown as shape and texture only — no readable text.",
      },
      {
        slug: "is-material-macro",
        scene:
          "Macro shot of a single key material or product that defines the craft, natural lighting, no labels and no packaging text.",
      },
      {
        slug: "is-workbench",
        scene:
          "Owner mid-process at a workbench or work station, back view or three-quarter side view, surrounded by the tools of this specific trade.",
      },
      {
        slug: "is-display-arrange",
        scene:
          "Hands arranging a small display of products for sale, careful spacing, soft directional light. No price tags with readable numbers.",
      },
      {
        slug: "is-inside-out",
        scene:
          "Wide indoor view from inside the shop looking outward toward the entrance, owner's back partly visible in foreground at work.",
      },
    ],
  },
  {
    slug: "failure_recovery",
    keywords: [
      "失敗",
      "ミス",
      "あるある",
      "直し方",
      "処方箋",
      "間違い",
      "改善",
      "悩み",
      "Q&A",
      "解決",
      "落とし穴",
    ],
    scenes: [
      {
        slug: "fr-fix-detail",
        scene:
          "Foreground: hands fixing a small detail of a product or arrangement. Background slightly out of focus showing the earlier imperfect state. No text.",
      },
      {
        slug: "fr-inspect-close",
        scene:
          "Owner inspecting a product up close with a slight frown of concentration, face in three-quarter profile only, not centered. Daylight working tone.",
      },
      {
        slug: "fr-redo-step",
        scene:
          "Close-up of hands re-doing a step that was previously wrong — re-folding, re-tying, re-arranging. Focus on the careful redo.",
      },
      {
        slug: "fr-step-back",
        scene:
          "Owner standing a step back from a finished arrangement, arms relaxed, evaluating. Back view at three-quarter angle.",
      },
      {
        slug: "fr-straighten",
        scene:
          "Small correction in motion — straightening a crooked frame (frame blank), adjusting a tilted display, smoothing a fabric. Indoor working light.",
      },
      {
        slug: "fr-hand-replacement",
        scene:
          "One hand holding a returned or imperfect item, the other hand reaching toward a tool or replacement. Both hands visible, no face.",
      },
    ],
  },
  {
    slug: "content_creation_ideas",
    keywords: [
      "ネタ",
      "アイデア",
      "切り口",
      "捻り",
      "発掘",
      "観察",
      "ヒント",
      "気づき",
      "発見",
      "投稿の作り方",
      "材料",
    ],
    scenes: [
      {
        slug: "ci-market-walk",
        scene:
          "Owner walking through a market or supply area, hands selecting or carrying fresh materials. Three-quarter back view, daylight.",
      },
      {
        slug: "ci-inspect-material",
        scene:
          "Close-up of an owner's hand picking up a single ingredient, material, or component to inspect it. Focus on texture and grip.",
      },
      {
        slug: "ci-scan-shop",
        scene:
          "Wide shot of the inside of a workshop or shop as if scanning the space for inspiration — slight motion blur on the edges. No people centered.",
      },
      {
        slug: "ci-low-shelf",
        scene:
          "Owner kneeling near a low shelf or drawer inspecting stock, back view, mid-thought posture. Indoor working tone.",
      },
      {
        slug: "ci-turn-material",
        scene:
          "Hands turning over a single material — cloth, wood, produce, paper — to look at its underside. Soft natural light.",
      },
      {
        slug: "ci-doorway-watch",
        scene:
          "Owner pausing in the doorway watching the street outside, three-quarter profile. Calm observational moment.",
      },
      {
        slug: "ci-pencil-shape",
        scene:
          "Hands sketching a rough shape on plain paper with a pencil, strokes intentionally blurred — no readable diagrams or letters.",
      },
    ],
  },
  {
    slug: "general",
    keywords: [], // fallback — matched only when nothing else scores
    scenes: [
      {
        slug: "gn-central-work",
        scene:
          "Owner mid-task at the center of their daily work, both hands engaged, face out of frame. Soft natural daylight from the side.",
      },
      {
        slug: "gn-interior-wide",
        scene:
          "Wide architectural shot of the working interior of a small owner-operated business, evidence of the day's work visible, owner's back partially in frame.",
      },
      {
        slug: "gn-tool-grip",
        scene:
          "Close-up of a single key tool of the trade being held mid-use. Hand visible only at the grip.",
      },
      {
        slug: "gn-counter-task",
        scene:
          "Owner standing at the entrance or counter, back view, doing a small everyday task. Working ambient light.",
      },
      {
        slug: "gn-material-prep",
        scene:
          "A material or product being prepared by hand, close framing, focus on the texture and technique.",
      },
      {
        slug: "gn-pre-open",
        scene:
          "A quiet moment in the shop before customers arrive — equipment ready, owner walking through the space. Soft daylight.",
      },
    ],
  },
];

const GENERAL_CATEGORY: SceneCategory = PILLAR_SCENE_CATEGORIES.find(
  (c) => c.slug === "general",
)!;

/**
 * Score-based categorization. Each category gets one point per keyword
 * present in pillar.name + pillar.description (case-insensitive). The
 * highest-scoring category wins; ties resolve to whichever appears
 * first in PILLAR_SCENE_CATEGORIES, which lets us put more-specific
 * categories ahead of more-general ones. If no keyword matches at all,
 * falls through to "general".
 */
function categorizePillar(
  pillar: ContentPillar | null | undefined,
): SceneCategory {
  if (!pillar) return GENERAL_CATEGORY;
  const haystack = `${pillar.name ?? ""} ${pillar.description ?? ""}`
    .toLowerCase();
  let best: { cat: SceneCategory; score: number } = {
    cat: GENERAL_CATEGORY,
    score: 0,
  };
  for (const cat of PILLAR_SCENE_CATEGORIES) {
    if (cat.slug === "general") continue;
    let score = 0;
    for (const kw of cat.keywords) {
      if (haystack.includes(kw.toLowerCase())) score++;
    }
    if (score > best.score) best = { cat, score };
  }
  return best.cat;
}

/**
 * Pick one scene from the pillar's matched category, biased away from
 * scene slugs that appear in recentImageDescriptions (so consecutive
 * posts in the same category don't render the same scene). Returns
 * both the scene description (for the prompt) and the slug (encoded
 * into ai_description for next call's anti-recency hint).
 */
function pickPillarScene(
  pillar: ContentPillar | null | undefined,
  recentImageDescriptions: string[],
): { slug: string; scene: string; categorySlug: string } {
  const cat = categorizePillar(pillar);
  const picked = pickPoolEntry(cat.scenes, recentImageDescriptions);
  return { ...picked, categorySlug: cat.slug };
}

/**
 * 2026-05-24 #F1 — seasonal grounding for the image prompt.
 *
 * Mirrors the JST month math used by seasonal.ts so the body and the
 * image describe the same season for the same wall-clock date. Returns
 * an English block that both (a) tells Gemini what to depict (vegetation
 * / light / clothing appropriate to the current season) and (b) names
 * the season's negative markers — what NOT to draw. The negative half
 * is the half that actually moves the model off training-data defaults
 * like "lifestyle photo = autumn leaves".
 *
 * Date-driven, no hardcoded month. Falls back to a generic note if the
 * month value is somehow out of range.
 */
function buildSeasonContext(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const half = d <= 15 ? "early" : "late";
  switch (m) {
    case 1:
      return `Midwinter in Japan (${half} January). Bare deciduous trees, clear cold light, breath sometimes visible, people in coats / wool / scarves, dry pavement, indoor warmth. DO NOT depict: cherry blossoms, autumn leaves still on trees, pampas grass, short sleeves, lush summer foliage.`;
    case 2:
      return `Late winter in Japan (${half} February). Cold air, hints of plum blossom late in the month, coats and sweaters still worn, low warm sun. DO NOT depict: cherry blossoms in full bloom, autumn leaves, pampas grass, summer clothing, heavy autumn harvest.`;
    case 3:
      return `Early spring in Japan (${half} March). Plum and early cherry blossoms, mild light, light jackets, pale-green buds appearing. DO NOT depict: autumn leaves, fallen leaves, pampas grass, knit blankets, heavy winter coats, dense summer foliage.`;
    case 4:
      return `Spring in Japan (${half} April). Cherry blossoms early in the month then fresh light-green new leaves, mild warmer days, light jackets or long sleeves. DO NOT depict: autumn leaves, fallen leaves, pampas grass, heavy knitwear, snow, midsummer haze.`;
    case 5:
      return `Late spring / early summer in Japan (${half} May). Fresh vivid green foliage, warmer days, light clothing — short sleeves, linen, cotton. DO NOT depict: knit, sweaters, autumn leaves, fallen leaves, pampas grass, dried grasses, knit blankets, heavy coats, snow.`;
    case 6:
      return `Early summer / rainy season in Japan (${half} June). Lush deep-green foliage, soft diffuse light, occasional rain on pavement, umbrellas, short sleeves, breathable fabrics. DO NOT depict: autumn leaves, knitwear, sweaters, snow, dry harvest tones.`;
    case 7:
      return `Midsummer in Japan (${half} July). Bright strong sunlight, deep green vegetation, light short-sleeved clothing, cold drinks, fans, occasional cumulus clouds. DO NOT depict: knit, sweaters, autumn leaves, pampas grass, snow, heavy layered clothing.`;
    case 8:
      return `Late summer in Japan (${half} August). Strong heat continues, deep green or slightly tired summer foliage, light cotton clothing, cool drinks, evening cicada feel. DO NOT depict: knit, sweaters, autumn leaves yet, winter clothing, snow.`;
    case 9:
      return `Early autumn in Japan (${half} September). Foliage mostly green with first hints of yellowing in late month, evening coolness, light layered clothing, rice fields ripening. DO NOT depict: heavy snow, bare winter trees, summer beachwear, knit blankets yet, cherry blossoms.`;
    case 10:
      return `Autumn in Japan (${half} October). Trees beginning to turn yellow and orange, cool dry air, light jackets, autumn foods and harvest tones. DO NOT depict: cherry blossoms, summer beach scenes, heavy winter coats yet, snow, lush midsummer foliage.`;
    case 11:
      return `Late autumn in Japan (${half} November). Full autumn colors — red, orange, yellow leaves, fallen leaves on the ground, cool crisp air, layered clothing. DO NOT depict: cherry blossoms, summer foliage, snow, short sleeves, beachwear.`;
    case 12:
      return `Early winter in Japan (${half} December). Bare or thinning trees, cold air, warm interior light, coats and scarves, year-end mood. DO NOT depict: cherry blossoms, autumn leaves still on trees, short sleeves, summer foliage, pampas grass.`;
    default:
      return "Japan — depict only vegetation, light, and clothing that match the current real-world season; do not default to autumn aesthetics.";
  }
}

/**
 * 2026-05-24 #G2 — business-context grounding for the image prompt.
 *
 * Without this, the image prompt only sees a pillar slug (e.g.
 * "follower-deepening") and topic tags (snake_case English) — nothing
 * about WHAT KIND OF BUSINESS the account is. Result: a coffee-pour
 * decorative still life for a 飲食店 SNS post about menu mistakes.
 *
 * business_name is intentionally OMITTED — passing the literal name
 * risks Gemini rendering it as signage text inside the image despite
 * the ABSOLUTE RULE block above. Industry + world_view are enough to
 * shift the scene toward the actual business kind.
 *
 * Returns null when the config carries no useful grounding (no industry
 * AND no world_view) so the caller can skip the section entirely.
 */
function buildBusinessContext(
  aiConfig?: AiConfig | null,
): string | null {
  if (!aiConfig) return null;
  const industry = aiConfig.industry?.trim() || "";
  const worldView = aiConfig.world_view?.trim() || "";
  if (!industry && !worldView) return null;
  const parts: string[] = [];
  if (industry) {
    parts.push(
      `This is a ${industry} in Japan, owner-operated and small.`,
    );
  } else {
    parts.push("This is a small owner-operated business in Japan.");
  }
  if (worldView) {
    const summary =
      worldView.length > 240 ? `${worldView.slice(0, 240)}…` : worldView;
    parts.push(`World view: ${summary}`);
  }
  parts.push(
    "The scene must look like the inside, surroundings, daily work, or products of this exact kind of business — not a generic decorative lifestyle scene.",
  );
  return parts.join(" ");
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
    /** 2026-05-24 #F1: today's date, used to ground the prompt in the
     *  current season so it stays aligned with the body's seasonal
     *  hint (both derive from the same wall clock). */
    today?: Date;
    /** 2026-05-24 #G2: AiConfig for industry + world_view grounding. */
    aiConfig?: AiConfig | null;
  } = {},
): string {
  void content; // intentionally unused — see jsdoc

  const semanticSubjects = [...topicTags, ...hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  // 2026-05-24 style-variants: style preset (palette + composition only
  // since #G1) is still pillar-derived via FNV hash for consistency
  // across a pillar's posts. Scene is no longer pulled from this style;
  // it comes from PILLAR_SCENE_CATEGORIES below.
  const styleKey = styleKeyForPillar(
    options.pillar?.id ?? null,
    topicTags[0] ?? hashtags[0] ?? "default",
  );
  const style = IMAGE_STYLE_VARIANTS[styleKey];

  // 2026-05-24 #G1: scene now comes from the pillar's matched category
  // pool — industry-neutral templates that the G2 business context
  // skins to fit the actual business kind. Anti-recency filter still
  // applies, scoped to the matched category.
  const pickedScene = pickPillarScene(
    options.pillar,
    options.recentImageDescriptions ?? [],
  );

  const seasonContext = buildSeasonContext(options.today ?? new Date());
  const businessContext = buildBusinessContext(options.aiConfig);

  const parts: string[] = [];

  parts.push(
    "Generate a single photorealistic 4:5 vertical photograph documenting a real working moment of a Japanese small business.",
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

  // (2.5) Business + season grounding. Both are settings — they tell
  //       Gemini WHERE / WHEN the scene takes place. They live under
  //       the ABSOLUTE RULE block above, not as exceptions to it: any
  //       text shown on signage / packaging / screens is still
  //       forbidden by the rule above.
  if (businessContext) {
    parts.push(
      "## Business context (interpret as setting, DO NOT render as text)",
      businessContext,
    );
  }
  parts.push(
    "## Current season (interpret as setting, do NOT render as text)",
    seasonContext,
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
    /** 2026-05-24 #F1: today's date. Defaults to new Date() so legacy
     *  callers keep working, but autoSelect now passes through the
     *  same date the body's seasonalHint sees so body+image align. */
    today?: Date;
    /** 2026-05-24 #G2: AiConfig for industry + world_view grounding. */
    aiConfig?: AiConfig | null;
  } = {},
): { prompt: string; styleKey: ImageStyleKey; sceneSlug: string } {
  const styleKey = styleKeyForPillar(
    options.pillar?.id ?? null,
    topicTags[0] ?? hashtags[0] ?? "default",
  );
  const style = IMAGE_STYLE_VARIANTS[styleKey];
  // 2026-05-24 #G1: scene pool comes from the pillar's matched
  // category, not from the style preset. We pick ONCE here and pass
  // the chosen slug + scene text through the inline parts.push below
  // so the choice stays deterministic for the caller (autoSelect uses
  // the returned sceneSlug to update the anti-recency hint for the
  // NEXT call).
  const picked = pickPillarScene(
    options.pillar,
    options.recentImageDescriptions ?? [],
  );
  const sceneSlug = picked.slug;
  const scene = picked.scene;

  void content;
  const semanticSubjects = [...topicTags, ...hashtags]
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const seasonContext = buildSeasonContext(options.today ?? new Date());
  const businessContext = buildBusinessContext(options.aiConfig);

  const parts: string[] = [
    "Generate a single photorealistic 4:5 vertical photograph documenting a real working moment of a Japanese small business.",
    // ↓ DO NOT REMOVE OR WEAKEN — text-glyph fix from earlier #A.
    "## ABSOLUTE RULE — NO TEXT, DIAGRAMS, OR INFORMATIONAL GRAPHICS IN THE IMAGE",
    "The image MUST NOT contain ANY of the following: text, letters, words, characters, kanji, hiragana, katakana, numbers, captions, subtitles, watermarks, logos, brand marks, UI elements, labels, speech bubbles, signage, billboards, posters, menus, receipts, business cards, t-shirt prints, book covers, document text, screen text on phones or computers, blackboard writing, neon signs, or any other readable mark.",
    "Also forbidden: diagrams, flowcharts, charts, graphs, schematic drawings, blueprints, maps, UI mockups, app interfaces, dashboards, circuit diagrams, circuit boards, circuit-trace patterns, PCBs, block diagrams, network or node-and-edge drawings, mind maps, org charts, infographics, wall graphics depicting connected shapes, arrows linking boxes, abstract symbolic illustrations, icons, pictograms, or any drawn lines that imply meaning. Any technical or informational graphic of any kind is prohibited — the image must be purely photographic, real-world content only.",
    "Every surface that could carry writing OR diagrams (signs, screens, posters, packaging, clothing, papers, walls, whiteboards, blackboards, notebooks shown open) must be blank, naturally textured (wood grain / fabric weave / paper fiber), or fully out of focus. 'Decorative pattern' is NOT acceptable as a fallback — even abstract patterns can read as circuits, UI, or maps. Default to a plain real-world surface.",
    "Screens and displays specifically (laptop / tablet / phone / TV / monitor / dashboard / smartwatch): must be POWERED OFF (dark glass with a faint reflection), or COMPLETELY BLACK, or so heavily out of focus they read as a single dark surface. Never show a UI, app, icon, button, dashboard, chart, circuit pattern, PCB layout, wallpaper, or any drawn content on a screen — regardless of style preset.",
    "Photographic, naturalistic visuals only. No symbolic, schematic, or diagrammatic content of any kind. If you are uncertain whether something might be read as text or as a diagram, leave it out entirely.",
  ];
  // 2026-05-24 #G2 / #F1 — business + season grounding. Both sit under
  // the ABSOLUTE RULE block above, not as exceptions to it: any text on
  // signage / packaging / screens remains forbidden.
  if (businessContext) {
    parts.push(
      "## Business context (interpret as setting, DO NOT render as text)",
      businessContext,
    );
  }
  parts.push(
    "## Current season (interpret as setting, do NOT render as text)",
    seasonContext,
  );
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
