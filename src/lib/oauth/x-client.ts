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
