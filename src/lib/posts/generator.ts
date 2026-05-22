import {
  getAnthropic,
  POST_MODEL,
  POST_MODEL_PRICE,
} from "@/lib/ai/anthropic";
import type { AiConfig, GenerationMetadata } from "@/lib/supabase/types";
import { getMonthlyGoal } from "@/lib/strategy/monthly-goals";
import { getAudiencePreset } from "@/lib/strategy/audience-presets";
import { formatRecentTopicsForPrompt } from "@/lib/strategy/topic-tracking";
import {
  retryInstructionForDetection,
  validateJapaneseOutput,
  type DetectedRun,
} from "./validators";
import { weightedRenderedTweet } from "./x-text";

const REAL_MODE_GUARD = `

【絶対ルール：捏造禁止】
- 架空の人物（「常連の田中さん」など）を作らない
- 架空のエピソードを作らない
- 実際にない金額・年数・実績を作らない
- 不確かな情報は使わない
- 提供された営業時間・メニュー・価格・実話エピソードのみ使用すること`;

const LANGUAGE_GUARD = `

【出力言語の厳格な指定】
- 出力は **純粋な日本語のみ**（ひらがな・カタカナ・漢字・標準的な記号・絵文字）
- ハングル文字（누군가、안녕 など）の混入禁止
- 半角カタカナ（ｱｲｳｴｵ など）の混入禁止
- 罫線文字（┌┐└┘├ など）の混入禁止
- IPA や音声記号（ɟ、ʃ など）の混入禁止
- 中国語繁体字 / 簡体字 の混入禁止
- 英単語は固有名詞・ブランド名・URL のみ許可`;

function outputFormat(maxLen: number): string {
  // Content budget = total cap minus a small reserve for hashtags + the
  // "\n\n" + space separators that buildTweetText injects between them.
  // The hard guarantee is total ≤ maxLen; this hint is just to steer the
  // model so it doesn't bump up against the limit every time.
  const contentBudget = Math.max(50, maxLen - 60);
  // X uses a "weighted character" count: CJK / emoji / 全角句読点 = 2, ASCII /
  // 半角 = 1, URL = 23 fixed. So a 140 weighted limit ≈ 70 Japanese chars
  // (or ~140 ASCII chars). Teaching the model this explicitly keeps it
  // from over-counting when retrying.
  const jpCharBudget = Math.max(25, Math.floor(maxLen / 2) - 30);
  return `

【出力形式】
以下のJSON形式で必ず返してください：
\`\`\`json
{
  "content": "投稿本文（ハッシュタグなし、改行込み）",
  "hashtags": ["タグ1", "タグ2", "タグ3"],
  "theme": "今回の投稿テーマ（短く）",
  "topic_tags": ["snake_case_tag1", "snake_case_tag2"],
  "strategic_intent": "この投稿の狙い（1行、日本語、例: 火曜の仕事終わり需要を狙う）"
}
\`\`\`

【文字数制約（厳守 — X重み付き）】
- 投稿本文 + ハッシュタグ + 区切り文字 の **合計を ${maxLen} 重み以内** に
- X の数え方: 日本語1文字＝2重み、半角英数1文字＝1重み、URL＝23重み固定
- 目安: 日本語中心なら content 約 ${jpCharBudget} 文字以内（${contentBudget} 重み以内）
- 上限を超えた出力は無効とみなされ再生成されます

【制約】
- hashtagsは3-5個、なるべく自然な形で
- 改行を効果的に使う
- ハッシュタグは content には含めず、必ず hashtags 配列で返す
- topic_tags は snake_case の英小文字で 1〜3 個（例: morning_routine, menu_intro, weekday_promo）
- strategic_intent は 1 行、誰がどんなタイミングで読むことを想定したかが分かる短い日本語`;
}

/**
 * Compute the rendered tweet length the way X scores it ("weighted
 * characters" — CJK / emoji = 2, ASCII = 1, URL = 23). Mirrors the
 * publisher's pre-send check via the shared helper in x-text.ts so the
 * generator and publisher agree byte-for-byte on what fits.
 *
 * Replaces the old JS `.length` count — that under-counted JP drafts by
 * roughly 2× and caused X to reject 280-cap configs with 403/422.
 */
export function computeTweetLength(
  content: string,
  hashtags: string[],
): number {
  return weightedRenderedTweet(content, hashtags);
}

function buildStrategySection(
  aiConfig: AiConfig,
  context?: { scheduledTimeJst?: string },
): string {
  const goal = getMonthlyGoal(aiConfig.monthly_goal);
  const audience = getAudiencePreset(aiConfig.target_audience_preset);
  const recentTopicsText = formatRecentTopicsForPrompt(aiConfig.recent_topics);

  // If neither strategy field is set we return an empty string so the prompt
  // is byte-identical to the pre-Phase-13 build — existing users see no
  // change in output until they opt in.
  if (!goal && !audience && !aiConfig.target_audience_description) {
    return "";
  }

  const lines: string[] = ["", "【今月のマーケ目標】"];
  if (goal) {
    lines.push(`目標: ${goal.label}`);
    lines.push(`方向性: ${goal.description}`);
    lines.push(`推奨投稿テーマ: ${goal.content_themes.join(" / ")}`);
    lines.push(`トーン補正: ${goal.tone_modifier}`);
    if (context?.scheduledTimeJst && goal.optimal_times) {
      const hit = goal.optimal_times.some((t) =>
        context.scheduledTimeJst!.startsWith(t.slice(0, 2)),
      );
      if (hit) {
        lines.push(
          `※ この時刻 (${context.scheduledTimeJst}) は目標達成に有効な時間帯`,
        );
      }
    }
  } else {
    lines.push("（特に目標なし、汎用的に）");
  }

  lines.push("", "【ターゲット客層】");
  if (audience) {
    lines.push(audience.label);
    if (audience.lifestyle_hints.length > 0) {
      lines.push(`特徴: ${audience.lifestyle_hints.join(" / ")}`);
    }
    lines.push(`トーン: ${audience.tone_guidance}`);
    lines.push(`絵文字密度: ${audience.emoji_density}`);
  } else {
    lines.push("（特定の客層なし）");
  }
  if (aiConfig.target_audience_description) {
    lines.push(`補足: ${aiConfig.target_audience_description}`);
  }

  lines.push("", "【ネタ枯れ防止】", "直近30日に使った投稿テーマ:");
  lines.push(recentTopicsText);
  lines.push("");
  lines.push("▶ 上記と違う切り口で投稿を作ること。同じテーマの繰り返しは避ける。");

  return lines.join("\n");
}

export function buildSystemPrompt(
  aiConfig: AiConfig,
  context?: { scheduledTimeJst?: string },
): string {
  let prompt = aiConfig.generated_system_prompt ?? "";
  if (!prompt) {
    // Fallback if config has no system prompt yet — derive a minimal one.
    prompt = `あなたは ${aiConfig.business_name ?? aiConfig.name} のSNS担当です。
${aiConfig.world_view ?? ""}
口調: ${aiConfig.voice_tone ?? "親しみやすく丁寧"}`;
  }

  if (aiConfig.account_mode === "real") {
    prompt += REAL_MODE_GUARD;
  }

  // Hint hashtag pool if available so AI can pick from real ones.
  const pool = (aiConfig.hashtag_pool ?? []).filter(Boolean);
  if (pool.length > 0) {
    prompt += `\n\n【ハッシュタグ候補（できればここから選ぶ）】\n${pool.join(" / ")}`;
  }

  // Phase 13: marketing strategy section. Returns "" when nothing is
  // configured, preserving the pre-Phase-13 prompt byte-for-byte.
  prompt += buildStrategySection(aiConfig, context);

  // Phase 11.5: language guard. Always-on hint to keep the output JP-only.
  prompt += LANGUAGE_GUARD;

  // Phase 14: include the per-config length cap in the output format.
  prompt += outputFormat(aiConfig.max_post_length ?? 140);
  return prompt;
}

export function buildUserPrompt(
  theme?: string,
  context?: { recentOpenings?: string[] },
): string {
  let base = theme && theme.trim()
    ? `今日の投稿を作成してください。テーマ: ${theme.trim()}`
    : "今日の投稿を作成してください。前回の投稿と異なる切り口でお願いします。";

  const openings = (context?.recentOpenings ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (openings.length > 0) {
    base += `\n\n【直近の投稿の書き出し（避けるべきパターン）】\n${openings
      .map((s, i) => `${i + 1}. ${s}...`)
      .join("\n")}\n\n上記と **異なる切り口・書き出し** で投稿を作ること。同じ単語・同じ語感で始まる投稿が連続しないように。`;
  }
  return base;
}

export type GeneratedPost = {
  content: string;
  hashtags: string[];
  theme: string | null;
  /** Phase 13: 1–3 snake_case topic tags used for cross-post topic diversity. */
  topic_tags: string[];
  /** Phase 13: 1-line description of what the post is trying to do. */
  strategic_intent: string | null;
  /** Phase 11.5: first 30 chars of content for opening-diversity tracking. */
  opening_snippet: string;
  /** Phase 11.5: validator failures we accepted rather than blocked on. */
  warnings: string[];
  metadata: GenerationMetadata;
};

/**
 * Multi-stage JSON extraction (mirrors Phase 5.8 strategy).
 */
function extractJson(text: string): {
  content?: string;
  hashtags?: unknown;
  theme?: unknown;
  topic_tags?: unknown;
  strategic_intent?: unknown;
} | null {
  // 1) ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  // 2) first { ... last }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      /* continue */
    }
  }
  // 3) truncated recovery
  if (first !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let lastBalanced = -1;
    for (let i = first; i < text.length; i++) {
      const c = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) lastBalanced = i;
      }
    }
    if (lastBalanced > first) {
      try {
        return JSON.parse(text.slice(first, lastBalanced + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

function toStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
      .filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(/[、,・\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Call Claude to draft a single SNS post for the given AI config.
 */
export async function generatePostDraft(
  aiConfig: AiConfig,
  theme?: string,
  context?: { scheduledTimeJst?: string; recentOpenings?: string[] },
): Promise<GeneratedPost> {
  const anthropic = getAnthropic();
  const system = buildSystemPrompt(aiConfig, context);
  const baseUser = buildUserPrompt(theme, { recentOpenings: context?.recentOpenings });
  const attempts: string[] = [];
  const warnings: string[] = [];

  // Phase 11.5 + 14: up to 2 attempts. On each attempt we validate the raw
  // text for forbidden characters (language) AND compute the rendered tweet
  // length against the AI config's max_post_length cap. Either failure
  // triggers a retry with combined feedback. If both checks pass we break.
  const MAX_ATTEMPTS = 2;
  const maxLen = aiConfig.max_post_length ?? 140;
  let resp;
  let text = "";
  let lastDetected: DetectedRun[] = [];
  let lastLengthOverrun: { actual: number; max: number } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let userMessage = baseUser;
    if (attempt > 0) {
      if (lastDetected.length > 0) {
        userMessage += retryInstructionForDetection(lastDetected);
      }
      if (lastLengthOverrun) {
        userMessage += `\n\n【前回の出力エラー】\n前回の出力は合計 ${lastLengthOverrun.actual} 文字でした。上限 ${lastLengthOverrun.max} 文字を厳守してください（本文 + ハッシュタグ + 区切り文字を全て含む）。`;
      }
    }

    try {
      resp = await anthropic.messages.create({
        model: POST_MODEL,
        max_tokens: 1024,
        // Phase 7.5b: same per-AI-config system prompt is reused for every post
        // generation. Caching lets back-to-back generations hit the 5-min cache
        // for 90% off on input tokens. SDK 0.32 types lag the API.
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        messages: [{ role: "user", content: userMessage }],
      });
      attempts.push(attempt === 0 ? "anthropic_call" : "anthropic_retry");
    } catch (e) {
      throw new Error(
        `AI生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");

    // Language check on raw text first — fast pre-parse signal.
    const validation = validateJapaneseOutput(text);
    lastDetected = validation.valid ? [] : validation.detected;
    if (!validation.valid) {
      console.warn("[generator] language validation failed", {
        attempt,
        detected: lastDetected,
      });
    }

    // Length check on parsed content + hashtags (mirrors buildTweetText).
    const previewParsed = extractJson(text);
    let previewContent = "";
    let previewHashtags: string[] = [];
    if (previewParsed && typeof previewParsed.content === "string") {
      previewContent = previewParsed.content.trim();
      previewHashtags = toStringArray(previewParsed.hashtags).map((t) =>
        t.startsWith("#") ? t : `#${t}`,
      );
    } else {
      previewContent = text.trim();
    }
    const tweetLen = computeTweetLength(previewContent, previewHashtags);
    lastLengthOverrun =
      tweetLen > maxLen ? { actual: tweetLen, max: maxLen } : null;
    if (lastLengthOverrun) {
      console.warn("[generator] length check failed", {
        attempt,
        ...lastLengthOverrun,
      });
    }

    if (validation.valid && !lastLengthOverrun) break;

    if (attempt + 1 === MAX_ATTEMPTS) {
      if (lastDetected.length > 0) {
        attempts.push("language_check_failed");
        warnings.push(
          `言語チェックで ${MAX_ATTEMPTS} 回連続失敗（${lastDetected
            .map((d) => d.kind)
            .join(", ")}）。出力をそのまま採用しました。`,
        );
      }
      if (lastLengthOverrun) {
        attempts.push("length_check_failed");
        warnings.push(
          `文字数チェックで ${MAX_ATTEMPTS} 回連続失敗（${lastLengthOverrun.actual}/${lastLengthOverrun.max} 文字）。投稿前に内容確認推奨。`,
        );
      }
    }
  }

  if (!resp) {
    // Should be unreachable: catch block above throws on failure.
    throw new Error("AI 応答が取得できませんでした");
  }

  const parsed = extractJson(text);
  let content: string;
  let hashtags: string[];
  let parsedTheme: string | null;
  // Phase 13: extract topic_tags + strategic_intent if present. AI sometimes
  // omits them; either case is fine — we just store NULL/empty array.
  let topicTags: string[] = [];
  let strategicIntent: string | null = null;
  if (parsed) {
    topicTags = toStringArray(parsed.topic_tags).map((t) =>
      t.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""),
    ).filter(Boolean).slice(0, 3);
    const intent = toStr(parsed.strategic_intent);
    strategicIntent = intent.length > 0 ? intent : null;
  }

  if (parsed && typeof parsed.content === "string" && parsed.content.trim()) {
    attempts.push("json_block");
    content = toStr(parsed.content);
    hashtags = toStringArray(parsed.hashtags).map((t) =>
      t.startsWith("#") ? t : `#${t}`,
    );
    parsedTheme = toStr(parsed.theme) || theme || null;
  } else {
    // Fallback: store raw response as content with no hashtags.
    attempts.push("raw_fallback");
    content = text.trim() || "(AI応答が空でした)";
    hashtags = [];
    parsedTheme = theme || null;
  }

  // Calculate cost (USD)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const respUsage = resp.usage as any;
  const inputTokens = respUsage?.input_tokens ?? 0;
  const outputTokens = respUsage?.output_tokens ?? 0;
  const cacheCreate = respUsage?.cache_creation_input_tokens ?? 0;
  const cacheRead = respUsage?.cache_read_input_tokens ?? 0;
  const cost =
    (inputTokens / 1000) * POST_MODEL_PRICE.input +
    (outputTokens / 1000) * POST_MODEL_PRICE.output;
  console.log("[anthropic][cache] posts/generate", {
    input: inputTokens,
    cache_create: cacheCreate,
    cache_read: cacheRead,
    output: outputTokens,
  });

  const metadata: GenerationMetadata = {
    model: POST_MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_estimate: Number(cost.toFixed(6)),
    generated_at: new Date().toISOString(),
    prompt_strategy: aiConfig.account_mode,
    attempts,
  };

  return {
    content,
    hashtags,
    theme: parsedTheme,
    topic_tags: topicTags,
    strategic_intent: strategicIntent,
    opening_snippet: content.slice(0, 30),
    warnings,
    metadata,
  };
}
