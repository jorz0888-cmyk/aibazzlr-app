import { buildOauth1AuthHeader, type Oauth1Credentials } from "./oauth1";
import { X_SCOPES } from "@/lib/oauth/x-client";

const X_TWEETS_URL = "https://api.x.com/2/tweets";

/**
 * Phase 15 auth bundle. Callers pass either an OAuth 2.0 bearer (legacy)
 * or an OAuth 1.0a credentials set (preferred — matches n8n's known-good
 * config). publisher.ts picks based on what's saved on the account.
 *
 * `scopes` on the oauth2 variant is the list X actually granted at the
 * time of the connection (read from social_accounts.scopes). Logged on
 * failure to spot scope-shortage 403s (e.g. v2 media upload now wants
 * `media.write` which we don't request yet).
 */
export type XAuth =
  | { kind: "oauth2"; accessToken: string; scopes?: string[] | null }
  | { kind: "oauth1"; creds: Oauth1Credentials };

function buildAuthHeader(
  auth: XAuth,
  method: "GET" | "POST",
  url: string,
  formParams: Record<string, string> = {},
): string {
  if (auth.kind === "oauth2") return `Bearer ${auth.accessToken}`;
  return buildOauth1AuthHeader({
    method,
    url,
    formParams,
    creds: auth.creds,
  });
}

function authFingerprint(auth: XAuth): string {
  if (auth.kind === "oauth2") {
    return `oauth2/${auth.accessToken.slice(0, 8)}…(len=${auth.accessToken.length})`;
  }
  return `oauth1/consumer=${auth.creds.consumerKey.slice(0, 6)}…/token=${auth.creds.accessToken.slice(0, 8)}…`;
}

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
 * Compose the final tweet text from content + hashtags. The optional
 * `maxLen` argument lets callers supply the per-AI-config cap (Phase 14)
 * instead of the hard-coded X-Free-tier 280. Pass `null` to skip the
 * length check entirely (X server is then the final authority).
 */
export function buildTweetText(
  content: string,
  hashtags: string[],
  maxLen: number | null = 280,
): string {
  const tags = (hashtags ?? []).filter(Boolean).join(" ");
  const text = tags ? `${content}\n\n${tags}` : content;
  if (maxLen !== null && text.length > maxLen) {
    throw new Error(
      `投稿が${maxLen}文字を超えています（${text.length}文字）。本文かハッシュタグを短くしてください。`,
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

/**
 * Phase 15: route media upload to the endpoint each auth flavour
 * actually supports.
 *   - OAuth 1.0a → v1.1 upload.twitter.com (the path n8n proved works)
 *   - OAuth 2.0  → v2 api.x.com (only one v2 will accept Bearer)
 *
 * The 403 "oauth1 app permissions" error happens specifically when these
 * are crossed — that was the original bug.
 */
const X_MEDIA_UPLOAD_V1_URL = "https://upload.twitter.com/1.1/media/upload.json";
const X_MEDIA_UPLOAD_V2_URL = "https://api.x.com/2/media/upload";

export async function uploadImageToX(
  auth: XAuth,
  imageUrl: string,
): Promise<string> {
  // Fetch the image bytes ourselves first (Supabase public URL → bytes →
  // multipart). Done server-side because the X endpoint expects raw bytes.
  const fetched = await fetch(imageUrl);
  if (!fetched.ok) {
    throw new XApiError(
      `画像の取得に失敗しました (status=${fetched.status})`,
      fetched.status,
    );
  }
  const arrayBuf = await fetched.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  const mime = fetched.headers.get("content-type") ?? "image/jpeg";
  const form = new FormData();
  // Pass as Blob so undici fills in the proper Content-Type boundary.
  form.append("media", new Blob([bytes], { type: mime }), "image");
  if (auth.kind === "oauth2") {
    // v2 requires media_category for non-default types.
    form.append("media_category", "tweet_image");
  }

  const uploadUrl =
    auth.kind === "oauth1" ? X_MEDIA_UPLOAD_V1_URL : X_MEDIA_UPLOAD_V2_URL;

  // Diagnosis 2026-05-22: dump every aspect of the outgoing v2 upload
  // request so we can pin down the 403. Specifically we want to see:
  //  - which scopes the stored token actually has (vs what we requested),
  //  - that we're sending multipart (not base64 JSON) with media_category,
  //  - the bearer fingerprint so we know it's the right token.
  // Authorization header value is NEVER logged in full — only scheme + len.
  if (auth.kind === "oauth2") {
    console.log("[x-api] uploadImageToX → outgoing (oauth2 / v2)", {
      url: uploadUrl,
      method: "POST",
      bodyFormat: "multipart/form-data",
      mediaField: "media (Blob)",
      mediaCategory: "tweet_image",
      mediaMime: mime,
      mediaBytes: bytes.length,
      authScheme: "Bearer",
      bearerLen: auth.accessToken.length,
      bearerPrefix: auth.accessToken.slice(0, 8) + "…",
      requestedScopesAtConnect: [...X_SCOPES],
      tokenScopesOnFile: auth.scopes ?? "(not stored)",
      // Quick boolean so the line is grep-able in Vercel logs.
      hasMediaWriteScope: (auth.scopes ?? []).includes("media.write"),
    });
  } else {
    console.log("[x-api] uploadImageToX → outgoing (oauth1 / v1.1)", {
      url: uploadUrl,
      method: "POST",
      bodyFormat: "multipart/form-data",
      mediaBytes: bytes.length,
      auth: authFingerprint(auth),
    });
  }

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        // Multipart bodies are NOT part of the OAuth 1.0a signature base —
        // pass empty formParams.
        Authorization: buildAuthHeader(auth, "POST", uploadUrl),
      },
      body: form,
    });
  } catch (e) {
    throw new XApiError(
      `X media upload に接続できませんでした: ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    // Dump EVERYTHING X returned. The body is the ground truth for
    // diagnosing 403:
    //   - "Unsupported authentication" or scope error → missing media.write
    //   - "client app is not configured with appropriate oauth1 app
    //      permissions" → endpoint/auth-kind mismatch (we send oauth2
    //      to a v1-only endpoint, or vice versa)
    //   - "Forbidden" with no detail → app product/tier issue at X-side
    // No truncation here — these errors are short anyway, and we need
    // the full string to grep for "scope", "media.write", etc.
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      // Skip set-cookie etc — only the diagnostic headers.
      if (
        k === "content-type" ||
        k === "x-rate-limit-limit" ||
        k === "x-rate-limit-remaining" ||
        k === "x-rate-limit-reset" ||
        k === "x-response-time" ||
        k === "x-tfe-preauth-account-id"
      ) {
        respHeaders[k] = v;
      }
    });
    console.error("[x-api] uploadImageToX FAILED — full response dump", {
      status: response.status,
      statusText: response.statusText,
      url: uploadUrl,
      authKind: auth.kind,
      authFingerprint: authFingerprint(auth),
      tokenScopesOnFile:
        auth.kind === "oauth2" ? (auth.scopes ?? "(not stored)") : "(n/a)",
      requestedScopesAtConnect:
        auth.kind === "oauth2" ? [...X_SCOPES] : "(n/a)",
      hasMediaWriteScope:
        auth.kind === "oauth2"
          ? (auth.scopes ?? []).includes("media.write")
          : "(n/a)",
      mediaBytes: bytes.length,
      mediaMime: mime,
      responseHeaders: respHeaders,
      responseBodyFull: rawText,
    });
    let body: XApiBody = {};
    try {
      body = JSON.parse(rawText) as XApiBody;
    } catch {
      /* leave as empty */
    }
    const { message, rawDetail } = translateXError(response.status, body);
    throw new XApiError(`画像アップロード失敗: ${message}`, response.status, rawDetail);
  }

  // v2 response shape: { data: { id: "...", media_key: "..." } }.
  // We also accept the v1.1 shape (media_id_string / media_id) so the
  // same code keeps working if X temporarily flips us back.
  const json = (await response.json()) as {
    data?: { id?: string; media_key?: string };
    media_id_string?: string;
    media_id?: number;
  };
  const id =
    json.data?.id ??
    json.media_id_string ??
    (json.media_id ? String(json.media_id) : null);
  if (!id) {
    throw new XApiError(
      "X 側応答に media_id が含まれていませんでした",
      response.status,
    );
  }
  return id;
}

export async function postToX(
  auth: XAuth,
  text: string,
  mediaIds?: string[],
): Promise<XTweetResponse> {
  let response: Response;
  try {
    const body: Record<string, unknown> = { text };
    if (mediaIds && mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }
    response = await fetch(X_TWEETS_URL, {
      method: "POST",
      headers: {
        // OAuth 1.0a does NOT include JSON bodies in its signature base,
        // so we pass empty formParams.
        Authorization: buildAuthHeader(auth, "POST", X_TWEETS_URL),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new XApiError(
      `Xへの接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    console.error("[x-api] postToX failed", {
      status: response.status,
      url: X_TWEETS_URL,
      auth: authFingerprint(auth),
      contentType: response.headers.get("content-type"),
      hasMedia: (mediaIds?.length ?? 0) > 0,
      body: rawText.slice(0, 1000),
    });
    let body: XApiBody = {};
    try {
      body = JSON.parse(rawText) as XApiBody;
    } catch {
      /* leave as empty */
    }
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
