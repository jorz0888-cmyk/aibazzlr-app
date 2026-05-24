import {
  getAnthropic,
  POST_MODEL,
  POST_MODEL_PRICE,
} from "@/lib/ai/anthropic";
import type {
  AiConfig,
  ContentPillar,
  GenerationMetadata,
} from "@/lib/supabase/types";
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
  // 2026-05-24 length-fix: Anthropic Haiku is bad at counting weighted
  // characters internally, so the prompt has to do the math for it.
  //
  // X budget model:
  //   - JP/CJK/emoji char = 2 weighted
  //   - ASCII char        = 1 weighted
  //   - separator "\n\n"  = 2 weighted (2 LFs)
  //   - 1 space between tags = 1 weighted each
  //   - URL               = 23 weighted fixed
  //
  // 2026-05-24 #B: previous target was the "safe under-cap" math:
  //   contentBudgetWeighted = maxLen - 25     (= 115 at maxLen=140)
  //   jpCharTarget          = floor(/2) - 5   (= 52 at maxLen=140)
  // Haiku tends to under-shoot its target by ~30%, so at target=52
  // it landed at ~37-47 JP chars → 100-118 weighted total (well
  // under cap but thin). The user spec calls those drafts 淡白.
  //
  // New: aim for ~70% of maxLen as JP-char target. This intentionally
  // OVERSHOOTS the X weighted ceiling on the first attempt (e.g. at
  // maxLen=140 → target ~98 chars → ~200 weighted → over). The
  // existing post-generation validation + retry ratchet (NOT changed,
  // per spec) brings it back under. Net result: drafts land near the
  // cap with real content weight instead of bouncing low.
  const jpCharTarget = Math.max(40, Math.floor(maxLen * 0.7));
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

【投稿の長さ制限（厳守 — これを破ると無効になります）】
content（本文）は **日本語${jpCharTarget}文字以内**。長くしてはいけない。
hashtags は **最大3つ・各タグ最大8文字**。

なぜ短く：X は「日本語1文字 = 2 カウント、半角1文字 = 1 カウント、URL = 23 カウント」
で合計を数え、このアカウントの上限は **${maxLen} カウント（≈ 日本語${Math.round(maxLen / 2)}字）**。
本文＋ハッシュタグ＋区切りを合算するため、上記の本数・字数を守る必要がある。
※ 「${maxLen} カウント」を「${maxLen} 文字書ける」と誤解しないこと。日本語のまま
${maxLen} 字書くと ${maxLen * 2} カウントになり、X の上限を倍超過する。

【内容の制約】
- 改行は最大2つまで。${jpCharTarget}文字に到達するくらい中身を入れる（薄い1文だけで終わらせない）。
- ハッシュタグは content には絶対に含めず、hashtags 配列だけに入れる。
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

/**
 * "5月24日" style JP date for prompt context. Always JST regardless
 * of the server timezone so the displayed date matches the date the
 * stale-event window math is based on.
 */
function formatJstDateForPrompt(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

export function buildUserPrompt(
  theme?: string,
  context?: {
    recentOpenings?: string[];
    /** Phase 17: the pillar selected by the anti-recency engine. */
    pillar?: ContentPillar | null;
    /** Phase 17: short JP phrase describing the current season. */
    seasonalHint?: string | null;
    /**
     * 2026-05-24 #E follow-up: event keywords whose freshness window
     * recently ended. Surfaced in the prompt as an explicit
     * "do NOT mention these" list. Solves the case where the LLM
     * wrote "GW明け" on 5/24 even though the positive seasonal hint
     * had been sanitized — the LLM's training-data muscle memory
     * was the source, and only a negative suppression list stops it.
     */
    staleEvents?: string[];
    /** Phase 17: 8–10 recent post bodies for "don't reuse these" cue. */
    recentBodies?: string[];
  },
): string {
  let base = theme && theme.trim()
    ? `今日の投稿を作成してください。テーマ: ${theme.trim()}`
    : "今日の投稿を作成してください。前回の投稿と異なる切り口でお願いします。";

  // Phase 17: anti-recency-selected pillar. The system prompt teaches
  // the persona; this line tells the model which angle to take for
  // THIS post. Lives in user prompt so it varies per call (keeps the
  // system prompt cache hot).
  const pillar = context?.pillar;
  if (pillar) {
    base += `\n\n【今回の柱】\n${pillar.name} — ${pillar.description}\nこの切り口で投稿を組み立ててください。`;
  }

  // Phase 17: lightweight seasonal frame. Independent of pillar — model
  // can lean in or ignore depending on whether the combo makes sense.
  const seasonal = context?.seasonalHint?.trim();
  if (seasonal) {
    base += `\n\n【ゆるい季節背景】\n${seasonal}\n※ 自然な範囲で寄せてよいが、毎回触れる必要はない`;
  }

  // 2026-05-24 #E follow-up: explicit stale-event suppression.
  // Without this, the LLM kept writing "GW明け" / "新生活" on 5/24
  // from May training-data muscle memory, even after the positive
  // seasonal hint was sanitized of those words.
  const stale = (context?.staleEvents ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (stale.length > 0) {
    base += `\n\n【期間切れで使わない方が良い語（今日は ${formatJstDateForPrompt()}）】\n${stale.join(" / ")}\n※ これらは最近終わったイベント・季節キーワード。本文・テーマ・ハッシュタグの何処にも使わないこと（過去ネタとして振り返るのは可）。`;
  }

  // Phase 17: recent bodies for "don't repeat yourself" cue. More
  // powerful than just openings since fresh-feeling posts also need
  // to differ in structure and phrasing, not just first words. Kept
  // to ~10 to bound the prompt cost.
  const bodies = (context?.recentBodies ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (bodies.length > 0) {
    base += `\n\n【このアカウントの最近の投稿（再利用禁止）】\n${bodies
      .map((s, i) => `${i + 1}. ${s.slice(0, 140)}${s.length > 140 ? "…" : ""}`)
      .join("\n")}\n\n上記の投稿と、話題・書き出し・文の構造を明確に変えること。これらに登場するフックや言い回しを再利用しないこと。`;
  }

  // Phase 11.5 (kept for back-compat / extra signal): just the openings.
  // Less critical now that we pass full bodies above but it doesn't
  // hurt and helps the model when bodies were truncated.
  const openings = (context?.recentOpenings ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (openings.length > 0 && bodies.length === 0) {
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
  /** Phase 17: id of the pillar the caller picked (or null if none). */
  pillar_id: string | null;
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
  context?: {
    scheduledTimeJst?: string;
    recentOpenings?: string[];
    /** Phase 17: pre-selected pillar (anti-recency picked by caller). */
    pillar?: ContentPillar | null;
    /** Phase 17: getSeasonalHint() result, or null/empty to skip. */
    seasonalHint?: string | null;
    /** 2026-05-24 #E follow-up: stale-event suppression list. */
    staleEvents?: string[];
    /** Phase 17: ~10 recent post bodies for the "don't repeat" cue. */
    recentBodies?: string[];
  },
): Promise<GeneratedPost> {
  const anthropic = getAnthropic();
  const system = buildSystemPrompt(aiConfig, context);
  const baseUser = buildUserPrompt(theme, {
    recentOpenings: context?.recentOpenings,
    pillar: context?.pillar,
    seasonalHint: context?.seasonalHint,
    staleEvents: context?.staleEvents,
    recentBodies: context?.recentBodies,
  });
  const attempts: string[] = [];
  const warnings: string[] = [];

  // 2026-05-24 length-fix: bump to 4 attempts (was 2). Real-world
  // observation: Haiku often needs 2–3 retries to actually shorten a
  // first-shot 200-char output down under the 140 cap, because the
  // model treats the first hint as suggestive and the bar moves
  // only after explicit miss feedback.
  const MAX_ATTEMPTS = 4;
  const maxLen = aiConfig.max_post_length ?? 140;
  let resp;
  let text = "";
  let lastDetected: DetectedRun[] = [];
  let lastLengthOverrun: { actual: number; max: number } | null = null;
  let lastDraftText: { content: string; hashtags: string[] } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let userMessage = baseUser;
    if (attempt > 0) {
      if (lastDetected.length > 0) {
        userMessage += retryInstructionForDetection(lastDetected);
      }
      if (lastLengthOverrun && lastDraftText) {
        // 2026-05-24 length-fix: instead of a soft "stay under
        // {max}" reminder, give the model
        //   - the exact overshoot amount
        //   - a concrete JP-char target (much tighter than the cap)
        //   - the offending draft text so it can compress rather
        //     than guess what it wrote
        const over = lastLengthOverrun.actual - lastLengthOverrun.max;
        // On each retry, ratchet the JP-char target down by ~20%
        // until we leave headroom. attempt counts from 1 on retry.
        const baseJpTarget = Math.max(
          15,
          Math.floor((lastLengthOverrun.max - 25) / 2) - 5,
        );
        const tightenedJpTarget = Math.max(
          12,
          baseJpTarget - attempt * 8,
        );
        userMessage += `\n\n【再生成 (前回 ${lastLengthOverrun.actual} / ${lastLengthOverrun.max} 文字 — ${over} 文字超過)】
前回の content はこちら（短くするのが目的、JSON ではなく内容を見てください）：
"""
${lastDraftText.content}
"""
これを **日本語${tightenedJpTarget}文字以内** に圧縮した新しい content を返してください。
要点を残し、情緒的な装飾・繰り返し・改行を削る。
hashtags は最大3個、各タグ8文字以内。
それでも長い場合は文を1つ削るのが正解。`;
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
    // 2026-05-24 length-fix: remember the actual draft body so the
    // retry prompt can show it back to the model for compression.
    lastDraftText = lastLengthOverrun
      ? { content: previewContent, hashtags: previewHashtags }
      : null;
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
    pillar_id: context?.pillar?.id ?? null,
    warnings,
    metadata,
  };
}
