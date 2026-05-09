import type { ExtractedHearingData } from "@/lib/supabase/types";

/**
 * Compose the v14-style system prompt that will be used by the SNS-posting AI
 * for this specific brand. Built from the interviewer's structured output.
 */
export function buildV14SystemPrompt(d: ExtractedHearingData): string {
  const businessName = d.business_name?.trim() || "（ブランド名未設定）";
  const worldView = d.world_view?.trim() || "（世界観未設定）";
  const description = d.business_description?.trim() || "";
  const personaRole = d.persona_role?.trim() || "ブランド担当";
  const target = d.target_audience?.trim() || "（読者像未設定）";

  const must = (d.must_include_elements ?? []).slice(0, 3);
  const mustLines =
    must.length > 0
      ? must.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "1. （未設定）\n2. （未設定）\n3. （未設定）";

  const ngWords = (d.ng_words ?? []).filter(Boolean);
  const ngLine =
    ngWords.length > 0 ? ngWords.map((w) => `× ${w}`).join("\n") : "× （未設定）";

  const examples = (d.good_examples ?? []).filter(Boolean).slice(0, 3);
  const examplesBlock =
    examples.length > 0
      ? examples.map((e, i) => `${i + 1}. ${e}`).join("\n\n")
      : "（投稿例未登録）";

  const hashtags = (d.hashtag_pool ?? []).filter(Boolean);
  const hashtagBlock =
    hashtags.length > 0 ? hashtags.join(" / ") : "（ハッシュタグ未登録）";

  return `あなたは${businessName}のSNSアカウントを運用する人格です。

【絶対の世界観】
${worldView}

【投稿の必須3要素】
${mustLines}

【ペルソナ】
- 役割: ${personaRole}
${description ? `- ${description}` : ""}
- ターゲット読者: ${target}

【投稿の構造（テンプレ）】
[起] 主人公・場面・状況
[承] 行動・選択・数字
[転] 気づき・背景・なぜ
[結] 余韻のある一言・反転

【絶対NGワード】
${ngLine}
× 「絶対稼げる」「誰でも」「100%」などの煽り
× 情報商材臭

【目指す表現】
- 具体的な人物（顔が浮かぶ）
- 具体的な数字・年数・場面
- 共感とリアル感

【良い投稿の例】
${examplesBlock}

【ハッシュタグ】
2〜3個を以下から自然に選ぶ：
${hashtagBlock}

【その他のルール】
- 「！」3連続以上禁止
- 文頭を記号や=で始めない
- 過去14日の投稿テーマと被らせない
- 投稿文に分析の中身や手順を含めない`;
}

// ----------------------------------------------------------------------------
// JSON extraction
// ----------------------------------------------------------------------------

/**
 * Robust extractor for the interviewer's final structured output.
 *
 * Handles, in order:
 *   1. Fenced ```json ... ``` blocks
 *   2. Fenced ``` ... ``` (no language tag) that look like JSON
 *   3. Bare {...} containing "complete": ...
 *   4. Trailing-truncation: balanced-brace recovery from a partial response
 *
 * Returns null only if no plausible JSON object is found.
 */
export function tryExtractFinalJson(
  text: string,
): ExtractedHearingData | null {
  if (!text) return null;

  const candidates: string[] = [];

  // 1. ```json ... ```
  const fencedJson = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const m of fencedJson) candidates.push(m[1]);

  // 2. ``` ... ``` without language tag, but only if content starts with {
  const fencedAny = [...text.matchAll(/```\s*([\s\S]*?)```/g)];
  for (const m of fencedAny) {
    const inner = m[1].trim();
    if (inner.startsWith("{")) candidates.push(inner);
  }

  // 3. Bare object containing "complete":
  const bare = sliceBalancedObjectAround(text, /"complete"\s*:/);
  if (bare) candidates.push(bare);

  // 4. Try each candidate (most specific first)
  for (const raw of candidates) {
    const parsed = safeJsonParse(raw);
    if (parsed && parsed.complete === true) return parsed;
  }

  // 5. Last resort: any candidate that has the right shape, even without
  //    `complete: true` (for cases where Claude forgot the flag)
  for (const raw of candidates) {
    const parsed = safeJsonParse(raw);
    if (parsed && (parsed.business_name || parsed.world_view)) {
      return { complete: true, ...parsed };
    }
  }

  return null;
}

/**
 * Strip the fenced JSON block from a message so the user only sees the
 * conversational text.
 */
export function stripJsonFence(text: string): string {
  return text
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```\s*\{[\s\S]*?\}\s*```/g, "")
    .trim();
}

// ----- internals -----------------------------------------------------------

function safeJsonParse(input: string): (ExtractedHearingData & {
  complete?: boolean;
}) | null {
  const cleaned = cleanupJsonString(input);

  // First attempt: direct parse
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object") return obj;
  } catch {
    /* fall through */
  }

  // Second attempt: strip trailing comma errors and try again
  try {
    const fixed = cleaned.replace(/,(\s*[}\]])/g, "$1");
    const obj = JSON.parse(fixed);
    if (obj && typeof obj === "object") return obj;
  } catch {
    /* fall through */
  }

  // Third attempt: truncated JSON — find last balanced brace
  const truncated = recoverTruncatedJson(cleaned);
  if (truncated) {
    try {
      const obj = JSON.parse(truncated);
      if (obj && typeof obj === "object") return obj;
    } catch {
      /* give up */
    }
  }

  return null;
}

function cleanupJsonString(s: string): string {
  // Remove leading/trailing prose and code fences.
  let out = s.trim();
  out = out.replace(/^```(?:json)?\s*/i, "");
  out = out.replace(/```\s*$/i, "");
  // Some models emit smart quotes; normalize a few.
  out = out
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return out.trim();
}

function recoverTruncatedJson(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastBalanced = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) lastBalanced = i;
    }
  }
  if (lastBalanced > start) {
    return s.slice(start, lastBalanced + 1);
  }
  return null;
}

function sliceBalancedObjectAround(
  text: string,
  marker: RegExp,
): string | null {
  const m = marker.exec(text);
  if (!m) return null;
  let start = m.index;
  while (start >= 0 && text[start] !== "{") start--;
  if (start < 0) return null;
  // Try to find a balanced closing brace after the marker.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
