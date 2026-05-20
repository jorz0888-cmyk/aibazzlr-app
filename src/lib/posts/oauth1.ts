import crypto from "crypto";

/**
 * Phase 15: minimal OAuth 1.0a signer for X. n8n verified that the same
 * X App's OAuth 1.0a Consumer Key / Access Token combo lets POST /2/tweets
 * AND v1.1 media/upload succeed, while OAuth 2.0 hits 403 on both. So we
 * mirror n8n's auth flow exactly.
 *
 * Only the four bits we need to send:
 *  - method: "POST"
 *  - url: "https://api.x.com/2/tweets" (no query)
 *  - formParams: x-www-form-urlencoded fields (empty for our JSON / multipart
 *    bodies — X spec says the JSON body is NOT part of the signature base)
 *  - credentials: consumer + token + their secrets
 */

export type Oauth1Credentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

/**
 * RFC 3986 percent-encoding. Node's encodeURIComponent leaves
 * !*'() un-encoded; OAuth 1.0a's signature base requires them
 * encoded, so re-escape after the fact.
 */
export function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

export function buildOauth1AuthHeader({
  method,
  url,
  formParams = {},
  creds,
}: {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Endpoint URL **without** the query string. */
  url: string;
  /**
   * Only application/x-www-form-urlencoded body params or query-string
   * params go into the signature base. For multipart and JSON bodies pass
   * an empty object.
   */
  formParams?: Record<string, string>;
  creds: Oauth1Credentials;
}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.accessToken,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
  };

  // Signature base — all OAuth params + form params sorted by encoded key.
  const all: Record<string, string> = { ...oauthParams, ...formParams };
  const sortedPairs = Object.keys(all)
    .map((k) => [percentEncode(k), percentEncode(all[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedPairs)}`;
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const fullParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  // Authorization header — oauth_* fields only (form params stay in body),
  // sorted alphabetically for predictability.
  const headerParts = Object.keys(fullParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(fullParams[k])}"`)
    .join(", ");
  return `OAuth ${headerParts}`;
}

export function readEnvOauth1Consumer(): {
  consumerKey: string;
  consumerSecret: string;
} | null {
  const consumerKey = process.env.X_CONSUMER_KEY;
  const consumerSecret = process.env.X_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) return null;
  return { consumerKey, consumerSecret };
}
