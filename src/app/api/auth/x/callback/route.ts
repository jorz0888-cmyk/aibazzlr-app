import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteOauthSession,
  getOauthSessionByState,
} from "@/lib/db/oauth-sessions";
import {
  exchangeCodeForToken,
  fetchXUserInfo,
} from "@/lib/oauth/x-client";
import { encryptToken } from "@/lib/oauth/encryption";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";

function redirectWithParams(
  base: URL,
  params: Record<string, string>,
): NextResponse {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const xError = url.searchParams.get("error");
  const target = new URL("/dashboard/sns", request.url);

  if (xError) {
    return redirectWithParams(target, { error: xError });
  }
  if (!code || !state) {
    return redirectWithParams(target, { error: "missing_params" });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?error=unauthorized", request.url),
    );
  }

  // 1. Verify state + retrieve code_verifier
  let session;
  try {
    session = await getOauthSessionByState(supabase, state, user.id, "x");
  } catch (e) {
    const info = extractDbError(e);
    console.error("[X-OAUTH-CALLBACK] session lookup failed", info);
    return redirectWithParams(target, {
      error: "session_lookup_failed",
      detail: info.message,
    });
  }
  if (!session) {
    return redirectWithParams(target, { error: "invalid_state" });
  }

  // ENV check
  if (
    !process.env.X_CLIENT_ID ||
    !process.env.X_CLIENT_SECRET ||
    !process.env.X_CALLBACK_URL ||
    !process.env.TOKEN_ENCRYPTION_KEY
  ) {
    console.error("[X-OAUTH-CALLBACK] required env missing");
    return redirectWithParams(target, { error: "server_misconfigured" });
  }

  try {
    // 2. Exchange authorization_code → tokens
    const tokenResponse = await exchangeCodeForToken({
      code,
      codeVerifier: session.code_verifier,
      redirectUri: process.env.X_CALLBACK_URL,
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
    });

    // 3. Fetch X user profile
    const xUser = await fetchXUserInfo(tokenResponse.access_token);

    // 4. Encrypt tokens
    const encAccess = encryptToken(tokenResponse.access_token);
    const encRefresh = tokenResponse.refresh_token
      ? encryptToken(tokenResponse.refresh_token)
      : null;
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // 5. Upsert social_account
    const payload = {
      user_id: user.id,
      platform: "x" as const,
      platform_user_id: xUser.id,
      username: xUser.username,
      display_name: xUser.name,
      profile_image_url: xUser.profile_image_url ?? null,

      access_token: encAccess.ciphertext,
      access_token_iv: encAccess.iv,
      access_token_tag: encAccess.tag,
      refresh_token: encRefresh?.ciphertext ?? null,
      refresh_token_iv: encRefresh?.iv ?? null,
      refresh_token_tag: encRefresh?.tag ?? null,

      token_expires_at: expiresAt.toISOString(),
      scopes: tokenResponse.scope.split(" "),
      token_type: tokenResponse.token_type,

      status: "active" as const,
      last_synced_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("social_accounts")
      .upsert(payload, {
        onConflict: "user_id,platform,platform_user_id",
      });

    if (upsertError) {
      const info = extractDbError(upsertError);
      console.error("[X-OAUTH-CALLBACK] DB save failed", info);
      return redirectWithParams(target, {
        error: "save_failed",
        detail: info.message,
      });
    }

    // 6. Delete one-time oauth_session
    try {
      await deleteOauthSession(supabase, session.id);
    } catch (e) {
      console.warn("[X-OAUTH-CALLBACK] session cleanup failed (non-fatal)", e);
    }

    return redirectWithParams(target, { connected: "x" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[X-OAUTH-CALLBACK] exception", err);
    return redirectWithParams(target, {
      error: "callback_failed",
      detail: message,
    });
  }
}
