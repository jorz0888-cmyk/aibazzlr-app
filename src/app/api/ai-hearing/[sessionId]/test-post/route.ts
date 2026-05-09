import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHearingSession } from "@/lib/db/ai-hearing-sessions";
import { getAnthropic, HEARING_MODEL } from "@/lib/ai/anthropic";
import { normalizeAccountMode, type AccountMode } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ sessionId: string }> };

const DAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function buildFictionalUserPrompt(): string {
  const today = new Date();
  const dow = DAYS[today.getDay()];
  const month = today.getMonth() + 1;
  const day = today.getDate();

  return `今日は${month}月${day}日（${dow}）です。

あなたのブランドの世界観で、X（Twitter）への投稿を1つ作ってください。

【テーマ例（ランダムに選んで）】
- 今日の店内の様子
- 印象に残ったお客様のエピソード（具体的な一人を想像）
- 季節を感じる小さな瞬間
- 仕入れや仕込みの裏側
- 常連の方への感謝

【出力形式】
JSONのみ。説明や前置き不要：

\`\`\`json
{
  "tweet": "投稿文（200〜280字、ハッシュタグ含む、URLなし、文頭に=や記号入れない）",
  "image_concept": "投稿に合う画像のコンセプト（日本語で30字以内、誰でもイメージできる絵）",
  "theme_summary": "今回選んだテーマの一言要約（25字以内）"
}
\`\`\``;
}

function buildRealUserPrompt(): string {
  const today = new Date();
  const dow = DAYS[today.getDay()];
  const month = today.getMonth() + 1;
  const day = today.getDate();

  return `今日は${month}月${day}日（${dow}）です。

【重要：捏造禁止】
- システムプロンプトに記載された実情報のみを使ってください
- 架空のお客様や架空のエピソードを絶対に作らない
- 確認できない数字・年数・固有名詞を作らない
- 実情報が足りないテーマは選ばない

X（Twitter）への投稿を1つ作ってください。

【テーマ例（実情報がある中から選ぶ）】
- 今日のおすすめメニュー（看板メニュー or 季節限定）
- 営業情報の告知（今週の定休日、営業時間、特別営業など）
- 季節限定・日替わりの紹介
- 客層に役立つ実用情報
- 許可済みの実話エピソード（ストックがある場合のみ）

【出力形式】
JSONのみ。説明や前置き不要：

\`\`\`json
{
  "tweet": "投稿文（200〜280字、ハッシュタグ含む、URLなし、文頭に=や記号入れない、実情報のみ）",
  "image_concept": "投稿に合う画像のコンセプト（日本語で30字以内、誰でもイメージできる絵）",
  "theme_summary": "今回選んだテーマの一言要約（25字以内）"
}
\`\`\``;
}

function buildUserPromptFor(mode: AccountMode): string {
  return mode === "real" ? buildRealUserPrompt() : buildFictionalUserPrompt();
}

function extractJSON(text: string): {
  tweet?: string;
  image_concept?: string;
  theme_summary?: string;
} | null {
  // 1. ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  // 2. first { to last }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      /* continue */
    }
  }
  // 3. truncated recovery
  if (first !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastBalanced = -1;
    for (let i = first; i < text.length; i++) {
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
        if (depth === 0) lastBalanced = i;
      }
    }
    if (lastBalanced > first) {
      try {
        return JSON.parse(text.slice(first, lastBalanced + 1));
      } catch {
        /* give up */
      }
    }
  }
  return null;
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!session.generated_system_prompt) {
    return NextResponse.json(
      {
        error:
          "システムプロンプトがまだ生成されていません。プレビュー画面が完成してからお試しください。",
      },
      { status: 409 },
    );
  }

  const anthropic = getAnthropic();

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: HEARING_MODEL,
      max_tokens: 1500,
      system: session.generated_system_prompt,
      messages: [
        {
          role: "user",
          content: buildUserPromptFor(
            normalizeAccountMode(session.account_mode),
          ),
        },
      ],
    });
  } catch (e) {
    console.error("[test-post] anthropic call failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `AI呼び出しに失敗しました: ${e.message}`
            : "AI呼び出しに失敗しました",
      },
      { status: 502 },
    );
  }

  const text = resp.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");

  const parsed = extractJSON(text);
  if (!parsed || typeof parsed.tweet !== "string") {
    console.error("[test-post] parse failed", { preview: text.slice(0, 300) });
    return NextResponse.json(
      {
        error:
          "投稿の生成結果を解析できませんでした。もう一度お試しください。",
        debug_preview: text.slice(0, 200),
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    tweet: parsed.tweet.trim(),
    image_concept: (parsed.image_concept ?? "").trim(),
    theme_summary: (parsed.theme_summary ?? "").trim(),
  });
}
