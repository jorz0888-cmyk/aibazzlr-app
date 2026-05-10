import crypto from "crypto";

const X_AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const X_REVOKE_URL = "https://api.twitter.com/2/oauth2/revoke";
const X_USER_URL = "https://api.twitter.com/2/users/me";

export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access", // required for refresh_token
] as const;

export type XTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export type XUserInfo = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

// ----------------- PKCE / state generation ---------------------------------
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ----------------- Authorization URL ---------------------------------------
export function buildAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(X_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ----------------- Token exchange ------------------------------------------
function basicAuthHeader(clientId: string, clientSecret: string): string {
  return (
    "Basic " +
    Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  );
}

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
  });

  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`X token exchange failed [${res.status}]: ${errorText}`);
  }
  return (await res.json()) as XTokenResponse;
}

/**
 * Phase 7-2 convenience wrapper: pulls credentials from env so callers
 * don't have to. Throws a typed error so the caller can decide whether
 * to mark the account as token_invalid (refresh_token dead) or just
 * retry later (transient network failure).
 */
export class XRefreshError extends Error {
  /** True when the refresh_token itself is dead (re-auth required). */
  fatal: boolean;
  status: number;
  constructor(message: string, fatal: boolean, status: number) {
    super(message);
    this.fatal = fatal;
    this.status = status;
    this.name = "XRefreshError";
  }
}

export async function refreshXAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new XRefreshError(
      "X_CLIENT_ID / X_CLIENT_SECRET が未設定です",
      false,
      0,
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  let response: Response;
  try {
    response = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (e) {
    throw new XRefreshError(
      `Xへの接続に失敗: ${e instanceof Error ? e.message : String(e)}`,
      false,
      0,
    );
  }

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const code = errBody.error ?? "";
    const desc = errBody.error_description ?? "";
    // invalid_grant / invalid_request / unauthorized_client → refresh_token
    // が完全に無効。それ以外は一時的とみなす。
    const fatal =
      code === "invalid_grant" ||
      code === "invalid_request" ||
      code === "unauthorized_client" ||
      response.status === 401;
    throw new XRefreshError(
      `X token refresh failed (${response.status}) ${code}${desc ? `: ${desc}` : ""}`,
      fatal,
      response.status,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    // X always rotates the refresh_token; if absent (some flows omit it)
    // fall back to the one we sent so we don't lose access.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });

  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`X token refresh failed [${res.status}]: ${errorText}`);
  }
  return (await res.json()) as XTokenResponse;
}

// ----------------- User info -----------------------------------------------
export async function fetchXUserInfo(accessToken: string): Promise<XUserInfo> {
  const url = new URL(X_USER_URL);
  url.searchParams.set("user.fields", "profile_image_url,name,username");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`X user fetch failed [${res.status}]: ${errorText}`);
  }
  const json = (await res.json()) as { data: XUserInfo };
  return json.data;
}

// ----------------- Revoke (best-effort) ------------------------------------
export async function revokeToken(params: {
  token: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  const body = new URLSearchParams({
    token: params.token,
    token_type_hint: "access_token",
    client_id: params.clientId,
  });

  await fetch(X_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(params.clientId, params.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  }).catch(() => {
    /* swallow — caller deletes from DB regardless */
  });
}
