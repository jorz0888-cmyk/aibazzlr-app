import { getAnthropic, POST_MODEL } from "@/lib/ai/anthropic";
import type { AiConfig, ContentPillar } from "@/lib/supabase/types";

/**
 * Phase 17: content pillars + anti-recency selector.
 *
 * "Pillars" are 8 distinct angles a single AI persona rotates through
 * so the feed doesn't read like one note on repeat. They're not a fixed
 * cycle — the selector picks anti-recency-weighted, so popular pillars
 * still surface but never twice in a row, and rarely-used pillars get
 * boosted as they age.
 */

const DESIRED_PILLAR_COUNT = 8;
const SELECTOR_WINDOW = 20;
const EXCLUDE_LAST_N = 2;

/**
 * Slugify a Japanese / Latin name into a stable kebab-case id. Strips
 * everything that isn't ASCII letter / digit / hyphen, lowercases, and
 * falls back to a counter when the slug ends up empty (e.g. for an
 * all-katakana pillar name where no Latin survives).
 */
export function slugifyPillarName(name: string, fallbackIndex = 0): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) return base.slice(0, 60);
  return `pillar-${fallbackIndex + 1}`;
}

function buildPillarPrompt(aiConfig: AiConfig): string {
  // Distill just the parts that actually shape the angle. Long fields
  // like world_view are useful but we don't need the whole prompt —
  // pillars are a high-level frame, not a detailed brief.
  return `あなたは日本のSNS運用設計者です。以下の店舗/個人のSNS担当として、
投稿の「柱（コンテンツの切り口）」を ${DESIRED_PILLAR_COUNT} 個提案してください。

【対象】
- 業種: ${aiConfig.industry ?? "未設定"}
- 投稿者の役割: ${aiConfig.persona_role ?? "未設定"}
- ターゲット読者: ${aiConfig.target_audience ?? "未設定"}
- 声のトーン: ${aiConfig.voice_tone ?? "未設定"}
${aiConfig.business_name ? `- ビジネス名: ${aiConfig.business_name}` : ""}
${aiConfig.world_view ? `- 世界観の要約: ${aiConfig.world_view.slice(0, 300)}` : ""}

【柱の設計指針】
- ${DESIRED_PILLAR_COUNT} 個それぞれが互いに重ならない切り口であること
- ありがちな「日常」「告知」「お礼」のような抽象語ではなく、その業種・
  人物像ならではの具体的な角度にする
- description は 30〜60 文字、何を語る柱なのかが一発で伝わる具体性
- 同じ柱でも毎回違う中身が書けるくらい射程が広いこと（狭すぎ NG）

【出力形式】
以下の JSON のみを返してください。コードブロックも前後の解説も不要です。
{
  "pillars": [
    { "name": "柱の名前（10〜20文字、日本語可）", "description": "何を語る切り口か（30〜60文字、具体的に）" }
  ]
}`;
}

type LLMPillar = { name: unknown; description?: unknown };

function extractPillarsJson(text: string): LLMPillar[] {
  // Try strict JSON first, then a forgiving regex pull. Anthropic
  // sometimes wraps in ```json fences despite instructions.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped) as { pillars?: unknown };
    if (Array.isArray(parsed.pillars)) return parsed.pillars as LLMPillar[];
  } catch {
    /* fall through */
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { pillars?: unknown };
      if (Array.isArray(parsed.pillars)) return parsed.pillars as LLMPillar[];
    } catch {
      /* swallow — caller will see empty and handle */
    }
  }
  return [];
}

/**
 * Call Anthropic to mint a fresh set of pillars for the given config.
 * Returns up to DESIRED_PILLAR_COUNT distinct pillars with stable ids.
 * Caller persists the result on ai_configs.content_pillars.
 *
 * Throws if the model returns no parseable JSON — caller decides
 * whether to surface as 502 (UI regen) or swallow + log (lazy gen).
 */
export async function generateContentPillars(
  aiConfig: AiConfig,
): Promise<ContentPillar[]> {
  const anthropic = getAnthropic();
  const resp = await anthropic.messages.create({
    model: POST_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildPillarPrompt(aiConfig) }],
  });
  const text = resp.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  console.log("[pillars] generated raw", {
    ai_config_id: aiConfig.id,
    chars: text.length,
    preview: text.slice(0, 200),
  });

  const raw = extractPillarsJson(text);
  if (raw.length === 0) {
    throw new Error("柱の生成に失敗しました（AI応答に JSON が含まれていません）");
  }

  // De-dupe by name (model occasionally repeats) and assign stable ids.
  const seen = new Set<string>();
  const out: ContentPillar[] = [];
  for (let i = 0; i < raw.length && out.length < DESIRED_PILLAR_COUNT; i++) {
    const p = raw[i];
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const description =
      typeof p.description === "string" ? p.description.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: slugifyPillarName(name, i),
      name,
      description,
    });
  }
  return out;
}

/**
 * Pick the next pillar to use, weighted to push diversity.
 *
 * Algorithm:
 *   - Exclude pillars used in the last EXCLUDE_LAST_N posts (so no
 *     back-to-back repeats).
 *   - For each remaining pillar, compute gap = (posts since last use,
 *     capped at SELECTOR_WINDOW). Pillars not used in the window get
 *     the max gap, so they're maximally attractive.
 *   - Weighted random by gap. Rarely-used pillars rise; recently-used
 *     ones still get a small chance.
 *   - Fallbacks: if exclusion empties the set → uniform random over
 *     all pillars; if no pillars at all → null (caller decides).
 *
 * `recentPillarIds` is ordered newest-first (the natural order from a
 * `ORDER BY created_at DESC LIMIT 20` read).
 */
export function selectPillarAntiRecency(
  pillars: ContentPillar[],
  recentPillarIds: (string | null)[],
): ContentPillar | null {
  if (pillars.length === 0) return null;

  const recent = recentPillarIds
    .map((id) => (typeof id === "string" ? id : null))
    .slice(0, SELECTOR_WINDOW);

  const excluded = new Set(
    recent.slice(0, EXCLUDE_LAST_N).filter((x): x is string => x !== null),
  );

  // Map pillar.id → gap (distance from index 0 in recent[]; SELECTOR_WINDOW
  // when unseen).
  const gap = new Map<string, number>();
  for (const p of pillars) {
    const idx = recent.indexOf(p.id);
    gap.set(p.id, idx === -1 ? SELECTOR_WINDOW : idx);
  }

  let candidates = pillars.filter((p) => !excluded.has(p.id));
  if (candidates.length === 0) {
    // Excluded everything (happens early when we have ≤2 pillars). Fall
    // back to uniform over the full list.
    candidates = pillars.slice();
  }

  // If we have basically no history (cold start) the gap signal is
  // useless — every pillar has the same max gap. Uniform random is
  // simpler and more honest than pretending to weight.
  const hasHistory = recent.some((x) => x !== null);
  if (!hasHistory) {
    const pick = Math.floor(Math.random() * candidates.length);
    return candidates[pick];
  }

  const weights = candidates.map((p) => Math.max(1, gap.get(p.id) ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
