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

/**
 * Best-effort JSON extraction from an interviewer message.
 * Returns the parsed object if a fenced JSON block with `complete: true`
 * is found, otherwise null.
 */
export function tryExtractFinalJson(
  text: string,
): ExtractedHearingData | null {
  // First try fenced ```json ... ```
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === "object" && parsed.complete === true) {
        return parsed as ExtractedHearingData;
      }
    } catch {
      /* fall through */
    }
  }

  // Fallback: locate the last balanced JSON object containing "complete":
  const idx = text.search(/"complete"\s*:/);
  if (idx === -1) return null;

  // Find the surrounding {...}
  let start = idx;
  while (start >= 0 && text[start] !== "{") start--;
  if (start < 0) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && parsed.complete === true) {
      return parsed as ExtractedHearingData;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Strip the fenced JSON block from a message so the user only sees the
 * conversational text.
 */
export function stripJsonFence(text: string): string {
  return text.replace(/```json\s*[\s\S]*?```/i, "").trim();
}
