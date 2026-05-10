const X_TWEETS_URL = "https://api.x.com/2/tweets";

export type XTweetResponse = {
  id: string;
  text: string;
  edit_history_tweet_ids?: string[];
};

export class XApiError extends Error {
  status: number;
  detail: string | null;
  constructor(message: string, status: number, detail?: string | null) {
    super(message);
    this.status = status;
    this.detail = detail ?? null;
    this.name = "XApiError";
  }
}

/**
 * Compose the final tweet text from content + hashtags. Validates the X 280-
 * character limit (counted as code units, matching X's display assumption for
 * Japanese text — reasonable approximation).
 */
export function buildTweetText(content: string, hashtags: string[]): string {
  const tags = (hashtags ?? []).filter(Boolean).join(" ");
  const text = tags ? `${content}\n\n${tags}` : content;
  if (text.length > 280) {
    throw new Error(
      `投稿が280文字を超えています（${text.length}文字）。本文かハッシュタグを短くしてください。`,
    );
  }
  return text;
}

/**
 * Translate X API HTTP error codes into a user-friendly Japanese sentence.
 */
function describeXError(
  status: number,
  apiBody: { detail?: unknown; title?: unknown; errors?: unknown },
): string {
  const detail =
    (typeof apiBody.detail === "string" && apiBody.detail) ||
    (typeof apiBody.title === "string" && apiBody.title) ||
    null;

  switch (status) {
    case 401:
      return `Xのアクセストークンが期限切れまたは無効です（401）。再連携が必要です。${detail ? ` 詳細: ${detail}` : ""}`;
    case 403:
      return `X側でこの投稿が拒否されました（403 / 権限不足）。スコープ tweet.write を含むか、再連携してください。${detail ? ` 詳細: ${detail}` : ""}`;
    case 429:
      return `Xの投稿レート制限に達しました（429）。少し時間を置いてから再試行してください。${detail ? ` 詳細: ${detail}` : ""}`;
    case 422:
      return `Xに送信した投稿内容が不正でした（422）。${detail ?? "重複投稿などの可能性があります。"}`;
    default:
      if (status >= 500) {
        return `X側で一時的なエラーが発生しました（${status}）。再試行してください。${detail ? ` 詳細: ${detail}` : ""}`;
      }
      return `X APIエラー（${status}）${detail ? `: ${detail}` : ""}`;
  }
}

export async function postToX(
  accessToken: string,
  text: string,
): Promise<XTweetResponse> {
  let response: Response;
  try {
    response = await fetch(X_TWEETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    throw new XApiError(
      `Xへの接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new XApiError(
      describeXError(response.status, body),
      response.status,
      typeof body.detail === "string" ? body.detail : null,
    );
  }

  const json = (await response.json()) as { data?: XTweetResponse };
  if (!json.data?.id) {
    throw new XApiError(
      "Xからの応答に投稿IDが含まれていませんでした",
      response.status,
    );
  }
  return json.data;
}

export function buildPostUrl(username: string, tweetId: string): string {
  return `https://x.com/${username}/status/${tweetId}`;
}
