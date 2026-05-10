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
 * Keyword → user-friendly Japanese mapping. Matched against the lower-cased
 * concatenation of every text signal X returns (`detail` / `title` /
 * `errors[].message` / `type` URL). The first hit wins, so order them from
 * most-specific to most-generic.
 */
const X_ERROR_MAP: { match: string; message: string }[] = [
  {
    match: "duplicate",
    message:
      "同じ内容の投稿は連続できません。内容を変更して再生成してください。",
  },
  {
    match: "rate limit",
    message:
      "X APIのレート制限に達しました。しばらく時間を置いてから再試行してください。",
  },
  {
    match: "rate-limit",
    message:
      "X APIのレート制限に達しました。しばらく時間を置いてから再試行してください。",
  },
  {
    match: "tweet.write",
    message:
      "Xへの投稿権限（tweet.write）が不足しています。SNS連携画面から再連携してください。",
  },
  {
    match: "scope",
    message:
      "Xの認可スコープが不足しています。SNS連携画面から再連携してください。",
  },
  {
    match: "token_invalid",
    message: "Xの認証情報が無効になりました。再連携してください。",
  },
  {
    match: "invalid_token",
    message: "Xの認証情報が無効になりました。再連携してください。",
  },
  {
    match: "expired_token",
    message: "Xの認証の有効期限が切れました。再連携してください。",
  },
  {
    match: "unauthorized",
    message: "X認証エラー。SNS連携画面から再連携してください。",
  },
  {
    match: "tweet too long",
    message: "投稿が長すぎます。280文字以内に収めてください。",
  },
];

type XApiBody = {
  detail?: unknown;
  title?: unknown;
  type?: unknown;
  errors?: unknown;
};

/**
 * Collect every text fragment from the X v2 error body. v2 has at least two
 * shapes — `{ title, detail, type }` for problem+json, and `{ errors: [{
 * message, code }] }` for the older v1.1-style payload that v2 still
 * occasionally emits. Returns the joined string used for keyword matching
 * + the most-specific human-readable detail for fallback display.
 */
function gatherXErrorSignals(body: XApiBody): {
  haystack: string;
  detail: string | null;
} {
  const parts: string[] = [];
  const detailParts: string[] = [];

  if (typeof body.detail === "string" && body.detail) {
    parts.push(body.detail);
    detailParts.push(body.detail);
  }
  if (typeof body.title === "string" && body.title) {
    parts.push(body.title);
    detailParts.push(body.title);
  }
  if (typeof body.type === "string" && body.type) {
    parts.push(body.type);
  }
  if (Array.isArray(body.errors)) {
    for (const err of body.errors) {
      if (err && typeof err === "object") {
        const e = err as { message?: unknown; code?: unknown };
        if (typeof e.message === "string" && e.message) {
          parts.push(e.message);
          detailParts.push(e.message);
        }
        if (typeof e.code === "number" || typeof e.code === "string") {
          parts.push(`code:${e.code}`);
        }
      }
    }
  }

  return {
    haystack: parts.join(" ").toLowerCase(),
    detail: detailParts[0] ?? null,
  };
}

/**
 * Convert any X API failure into a friendly Japanese sentence.
 *
 * Strategy:
 *   1. Pull every textual signal out of the body
 *   2. Match against the keyword map (most-specific reasons win regardless
 *      of HTTP status — a 403 with "duplicate content" should NOT say
 *      "権限不足")
 *   3. If no keyword hit, fall back to status-code-specific phrasing
 *   4. As a last resort, surface the raw detail
 */
export function translateXError(
  status: number,
  body: XApiBody,
): { message: string; rawDetail: string | null } {
  const { haystack, detail } = gatherXErrorSignals(body);

  for (const { match, message } of X_ERROR_MAP) {
    if (haystack.includes(match)) {
      return { message, rawDetail: detail };
    }
  }

  // Status-code fallbacks — no keyword matched, lean on the HTTP code.
  if (status === 401) {
    return {
      message: `X認証エラー（401）。SNS連携画面から再連携してください。${detail ? ` 詳細: ${detail}` : ""}`,
      rawDetail: detail,
    };
  }
  if (status === 403) {
    return {
      message: `X側でこの投稿が拒否されました（403）${detail ? `: ${detail}` : "。詳細不明"}`,
      rawDetail: detail,
    };
  }
  if (status === 429) {
    return {
      message:
        "X APIのレート制限に達しました（429）。しばらくお待ちください。",
      rawDetail: detail,
    };
  }
  if (status === 422) {
    return {
      message: `Xに送信した投稿内容が不正でした（422）${detail ? `: ${detail}` : ""}`,
      rawDetail: detail,
    };
  }
  if (status >= 500) {
    return {
      message: `X側で一時的なエラーが発生しました（${status}）。再試行してください。${detail ? ` 詳細: ${detail}` : ""}`,
      rawDetail: detail,
    };
  }

  return {
    message: `X APIエラー（${status}）${detail ? `: ${detail}` : ""}`,
    rawDetail: detail,
  };
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
    const { message, rawDetail } = translateXError(response.status, body);
    throw new XApiError(message, response.status, rawDetail);
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
