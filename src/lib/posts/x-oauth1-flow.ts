import {
  buildOauth1AuthHeader,
  percentEncode,
  readEnvOauth1Consumer,
  signOauth1,
} from "./oauth1";

const X_REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const X_AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const X_ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";

export class XOauth1Error extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.name = "XOauth1Error";
  }
}

/** Parse an OAuth 1.0a response body (`application/x-www-form-urlencoded`). */
function parseFormBody(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) {
    out[k] = v;
  }
  return out;
}

export type RequestTokenResult = {
  oauthToken: string;
  oauthTokenSecret: string;
  /** X always sets this true when callback matches the App's whitelist. */
  callbackConfirmed: boolean;
};

/**
 * Step 1 of 3-legged OAuth 1.0a. We POST to oauth/request_token with our
 * Consumer Key/Secret + the callback URL signed in; X returns a temporary
 * token pair we then redirect the user to authorize.
 */
export async function requestRequestToken(
  callbackUrl: string,
): Promise<RequestTokenResult> {
  const consumer = readEnvOauth1Consumer();
  if (!consumer) {
    throw new XOauth1Error(
      "X_CONSUMER_KEY / X_CONSUMER_SECRET が未設定です",
      0,
    );
  }

  // oauth_callback is an OAuth 1.0a header param — goes into both the
  // signature base and the Authorization header. The signer's
  // `oauthExtras` channel handles that cleanly.
  const signed = signOauth1({
    method: "POST",
    url: X_REQUEST_TOKEN_URL,
    oauthExtras: { oauth_callback: callbackUrl },
    creds: {
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      accessToken: "",
      accessTokenSecret: "",
    },
  });

  // Phase 15 diagnostic dump — every value that goes over the wire,
  // alongside the percent-encoded form X actually sees in the signature
  // base. This is the ground truth for debugging 415 "Callback URL
  // not approved" errors: compare callbackEncoded with what the X Dev
  // Portal has stored and the bug is either obvious or eliminated.
  console.log("[oauth1/request_token] outgoing", {
    url: X_REQUEST_TOKEN_URL,
    method: "POST",
    callbackRaw: callbackUrl,
    callbackEncoded: percentEncode(callbackUrl),
    consumerKeyPrefix: consumer.consumerKey.slice(0, 8) + "…",
    consumerKeyLen: consumer.consumerKey.length,
    signatureBase: signed.signatureBase,
    paramString: signed.paramString,
    oauthParams: signed.oauthParams,
    authorizationHeader: signed.header,
  });

  const res = await fetch(X_REQUEST_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: signed.header },
  });
  const bodyText = await res.text();
  console.log("[oauth1/request_token] response", {
    status: res.status,
    body: bodyText.slice(0, 1000),
  });
  if (!res.ok) {
    console.error("[x-oauth1-flow] request_token failed", {
      status: res.status,
      body: bodyText.slice(0, 500),
    });
    throw new XOauth1Error(
      `X oauth/request_token (${res.status}): ${bodyText.slice(0, 200)}`,
      res.status,
    );
  }
  const parsed = parseFormBody(bodyText);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new XOauth1Error(
      "X oauth/request_token 応答に oauth_token が含まれていません",
      res.status,
    );
  }
  return {
    oauthToken: parsed.oauth_token,
    oauthTokenSecret: parsed.oauth_token_secret,
    callbackConfirmed: parsed.oauth_callback_confirmed === "true",
  };
}

export function buildAuthorizeUrl(oauthToken: string): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("oauth_token", oauthToken);
  return url.toString();
}

export type AccessTokenResult = {
  oauthToken: string;
  oauthTokenSecret: string;
  userId: string;
  screenName: string;
};

/**
 * Step 3 of 3-legged OAuth 1.0a. We POST to oauth/access_token with the
 * request_token + its secret (signing key now includes both halves) and
 * the verifier the user got from X. X returns a long-lived user
 * access_token + secret + the X user id / screen name.
 */
export async function exchangeForAccessToken(
  requestToken: string,
  requestTokenSecret: string,
  oauthVerifier: string,
): Promise<AccessTokenResult> {
  const consumer = readEnvOauth1Consumer();
  if (!consumer) {
    throw new XOauth1Error(
      "X_CONSUMER_KEY / X_CONSUMER_SECRET が未設定です",
      0,
    );
  }

  const authHeader = buildOauth1AuthHeader({
    method: "POST",
    url: X_ACCESS_TOKEN_URL,
    // oauth_verifier MUST be in the signature base.
    formParams: { oauth_verifier: oauthVerifier },
    creds: {
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      accessToken: requestToken,
      accessTokenSecret: requestTokenSecret,
    },
  });

  // X expects oauth_verifier in the body for this call.
  const body = new URLSearchParams({ oauth_verifier: oauthVerifier });
  const res = await fetch(X_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error("[x-oauth1-flow] access_token failed", {
      status: res.status,
      body: bodyText.slice(0, 500),
    });
    throw new XOauth1Error(
      `X oauth/access_token (${res.status}): ${bodyText.slice(0, 200)}`,
      res.status,
    );
  }
  const parsed = parseFormBody(bodyText);
  if (
    !parsed.oauth_token ||
    !parsed.oauth_token_secret ||
    !parsed.user_id ||
    !parsed.screen_name
  ) {
    throw new XOauth1Error(
      "X oauth/access_token 応答に必須フィールドが欠けています",
      res.status,
    );
  }
  return {
    oauthToken: parsed.oauth_token,
    oauthTokenSecret: parsed.oauth_token_secret,
    userId: parsed.user_id,
    screenName: parsed.screen_name,
  };
}
