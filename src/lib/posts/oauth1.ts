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
  /** Empty string for the request_token (no user token yet) step. */
  accessToken: string;
  /** Empty string for the request_token (no user token secret yet) step. */
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

export type Oauth1SignResult = {
  /** The fully-formed value to use in `Authorization:` header. */
  header: string;
  /** The HMAC-SHA1 signature base string (debug). */
  signatureBase: string;
  /** sorted `key=value&key=value` paramstring fed into base (debug). */
  paramString: string;
  /** All OAuth params (incl. signature) used in the header (debug). */
  oauthParams: Record<string, string>;
};

export function signOauth1({
  method,
  url,
  formParams = {},
  oauthExtras = {},
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
  /**
   * Additional OAuth 1.0a header params that go into BOTH the signature
   * base AND the Authorization header — needed for the 3-legged flow's
   * oauth_callback (request_token step) and oauth_verifier (alternative
   * to body-passing in the access_token step).
   */
  oauthExtras?: Record<string, string>;
  creds: Oauth1Credentials;
}): Oauth1SignResult {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
    ...oauthExtras,
  };
  // Phase 15 (3-legged): the request_token step is fired BEFORE we have
  // a user token, so oauth_token must not appear in either the header
  // or the signature base. We treat an empty accessToken as "skip".
  if (creds.accessToken) {
    oauthParams.oauth_token = creds.accessToken;
  }

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
  return {
    header: `OAuth ${headerParts}`,
    signatureBase: baseString,
    paramString: sortedPairs,
    oauthParams: fullParams,
  };
}

/** Thin wrapper for call sites that don't need the signing intermediates. */
export function buildOauth1AuthHeader(
  opts: Parameters<typeof signOauth1>[0],
): string {
  return signOauth1(opts).header;
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
