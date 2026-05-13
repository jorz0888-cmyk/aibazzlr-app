import {
  getAnthropic,
  POST_MODEL,
  POST_MODEL_PRICE,
} from "@/lib/ai/anthropic";
import type { AiConfig, GenerationMetadata } from "@/lib/supabase/types";

const REAL_MODE_GUARD = `

【絶対ルール：捏造禁止】
- 架空の人物（「常連の田中さん」など）を作らない
- 架空のエピソードを作らない
- 実際にない金額・年数・実績を作らない
- 不確かな情報は使わない
- 提供された営業時間・メニュー・価格・実話エピソードのみ使用すること`;

const OUTPUT_FORMAT = `

【出力形式】
以下のJSON形式で必ず返してください：
\`\`\`json
{
  "content": "投稿本文（ハッシュタグなし、改行込み）",
  "hashtags": ["タグ1", "タグ2", "タグ3"],
  "theme": "今回の投稿テーマ（短く）"
}
\`\`\`

【制約】
- contentは200文字以内（ハッシュタグ用に余裕を残す）
- hashtagsは3-5個、なるべく自然な形で
- 改行を効果的に使う
- ハッシュタグは content には含めず、必ず hashtags 配列で返す`;

export function buildSystemPrompt(aiConfig: AiConfig): string {
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

  prompt += OUTPUT_FORMAT;
  return prompt;
}

export function buildUserPrompt(theme?: string): string {
  if (theme && theme.trim()) {
    return `今日の投稿を作成してください。テーマ: ${theme.trim()}`;
  }
  return "今日の投稿を作成してください。前回の投稿と異なる切り口でお願いします。";
}

export type GeneratedPost = {
  content: string;
  hashtags: string[];
  theme: string | null;
  metadata: GenerationMetadata;
};

/**
 * Multi-stage JSON extraction (mirrors Phase 5.8 strategy).
 */
function extractJson(text: string): {
  content?: string;
  hashtags?: unknown;
  theme?: unknown;
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
): Promise<GeneratedPost> {
  const anthropic = getAnthropic();
  const system = buildSystemPrompt(aiConfig);
  const user = buildUserPrompt(theme);
  const attempts: string[] = [];

  let resp;
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
      messages: [{ role: "user", content: user }],
    });
    attempts.push("anthropic_call");
  } catch (e) {
    throw new Error(
      `AI生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const text = resp.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");

  const parsed = extractJson(text);
  let content: string;
  let hashtags: string[];
  let parsedTheme: string | null;

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

  return { content, hashtags, theme: parsedTheme, metadata };
}
