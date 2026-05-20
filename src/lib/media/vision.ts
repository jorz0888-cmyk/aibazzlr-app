/**
 * Phase 12.1: ask Gemini Vision to label an uploaded image with SNS-ready
 * tags + a one-line description. Same raw-fetch pattern as /api/media/generate
 * so we don't add a new SDK dependency.
 *
 * Always fail-soft — any error returns null and the caller should leave the
 * row's tags / ai_description untouched.
 */

export type VisionAnalysis = {
  tags: string[];
  description: string;
};

const SYSTEM_PROMPT = `この画像を SNS 投稿用にメタデータ化してください。
以下を JSON で出力：

{
  "tags": ["タグ1", "タグ2", ...],
  "description": "1〜2行の日本語説明"
}

タグの方針:
- 3〜5個
- 日本語、SNS で検索しやすい単語
- 食べ物 / 場所 / 雰囲気 / 人物 / 物 のいずれか
- 「画像」「写真」のような抽象語、「美しい」のような主観表現、同義語の重複は避ける

description:
- 何が写っているか + 雰囲気を 1〜2行
- 主観・形容詞は最小限
- 200文字以内

出力は **JSON のみ**。前置きや \`\`\` フェンスも書かない。`;

function extractJson(text: string): { tags?: unknown; description?: unknown } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0 && t.length <= 32)
    .slice(0, 5);
}

export async function analyzeImageWithVision(
  imageUrl: string,
): Promise<VisionAnalysis | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash";

  let imageResponse: Response;
  try {
    imageResponse = await fetch(imageUrl);
  } catch (e) {
    console.warn("[vision] fetch image failed", e);
    return null;
  }
  if (!imageResponse.ok) {
    console.warn("[vision] image not reachable", imageResponse.status);
    return null;
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString("base64");
  const mimeType =
    imageResponse.headers.get("content-type") ?? "image/jpeg";

  let resp: Response;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: SYSTEM_PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
  } catch (e) {
    console.warn("[vision] gemini fetch failed", e);
    return null;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn("[vision] gemini error", resp.status, body.slice(0, 200));
    return null;
  }

  type GeminiPart = { text?: string };
  type GeminiResp = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  const json = (await resp.json().catch(() => null)) as GeminiResp | null;
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";
  if (!text) {
    console.warn("[vision] empty response");
    return null;
  }

  const parsed = extractJson(text);
  const tags = normalizeTags(parsed?.tags);
  const description =
    typeof parsed?.description === "string"
      ? parsed.description.trim().slice(0, 200)
      : "";
  if (tags.length === 0 && !description) {
    console.warn("[vision] parsed payload empty", text.slice(0, 200));
    return null;
  }
  return { tags, description };
}

/**
 * Merge an AI-generated tag list into a user-provided one without losing
 * the user's entries. User tags keep their order at the front; AI tags
 * are appended in their original order, case-insensitively de-duped.
 */
export function mergeTags(
  userTags: string[] | null | undefined,
  aiTags: string[],
): string[] {
  const user = (userTags ?? []).map((t) => t.trim()).filter(Boolean);
  const userLower = new Set(user.map((t) => t.toLowerCase()));
  const additions = aiTags
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !userLower.has(t.toLowerCase()));
  return [...user, ...additions];
}
