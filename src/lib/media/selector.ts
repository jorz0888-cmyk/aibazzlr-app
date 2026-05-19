import { getAnthropic, HEARING_MODEL } from "@/lib/ai/anthropic";
import type { MediaLibraryRow } from "@/lib/supabase/types";

/**
 * Ask Claude to pick the single most-fitting library image for a post, or
 * null if nothing matches. Text-based: we feed it the candidates' tags +
 * ai_description, not the pixels — keeps the call cheap and fast.
 *
 * Fail-soft: any exception returns null so the publish path proceeds without
 * an image rather than blocking generation.
 */
export async function selectFromLibrary(
  postContent: string,
  hashtags: string[],
  candidates: MediaLibraryRow[],
): Promise<MediaLibraryRow | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Build a compact catalogue. We index by 0..N so Claude returns a small
  // integer rather than echoing a UUID (which it sometimes mis-types).
  const catalogue = candidates
    .map((c, i) => {
      const tagList = c.tags.length > 0 ? c.tags.join(", ") : "(no tags)";
      const desc = c.ai_description?.trim() ?? "(no description)";
      return `[${i}] tags=${tagList} | description=${desc}`;
    })
    .join("\n");

  const system = `あなたは SNS 投稿担当のアシスタントです。
これから渡される投稿本文に最も合う1枚の画像をライブラリから選んでください。

【判定ルール】
- タグや説明から、投稿テーマと明確に関連する画像を優先
- 関連性が低い、または不明な場合は -1 (該当なし) を返す
- 飲食店の投稿なら料理写真 > 店内 > スタッフ > メニュー > 関係ないもの
- 季節限定 / 新メニュー言及があれば、それに対応するタグの画像を優先
- 出力は **1つの整数のみ**（番号 0..N-1、または該当なしなら -1）
- それ以外の文字は一切出力しない`;

  const user = `投稿本文:
${postContent}

ハッシュタグ:
${hashtags.length > 0 ? hashtags.join(" ") : "(なし)"}

ライブラリ:
${catalogue}

最適な画像の番号（0..${candidates.length - 1}、該当なしなら -1）を整数1つだけ返してください。`;

  try {
    const client = getAnthropic();
    const resp = await client.messages.create({
      model: HEARING_MODEL,
      max_tokens: 16,
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
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const m = text.match(/-?\d+/);
    if (!m) return null;
    const idx = Number(m[0]);
    if (!Number.isFinite(idx)) return null;
    if (idx < 0 || idx >= candidates.length) return null;
    return candidates[idx];
  } catch (e) {
    console.error("[media/selector] anthropic call failed", e);
    return null;
  }
}
