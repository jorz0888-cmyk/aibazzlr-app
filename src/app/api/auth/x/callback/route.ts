import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  deleteOauthSession,
  getOauthSessionByState,
} from "@/lib/db/oauth-sessions";
import {
  exchangeCodeForToken,
  fetchXUserInfo,
} from "@/lib/oauth/x-client";
import { encryptToken } from "@/lib/oauth/encryption";
import { syncPlatformIds } from "@/lib/db/social-accounts";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 300;

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

    // 4.5 Phase 18: cross-user check. The partial unique index
    //     social_accounts_active_platform_account_unique would reject
    //     this insert with a 23505 anyway, but raw errors leave the
    //     user on a generic "save_failed" screen. We pre-check with
    //     the admin client (RLS would hide other users' rows) so we
    //     can return a clean JP message and exit before encrypting
    //     anything we won't use.
    const admin = createAdminClient();
    const { data: cross } = await admin
      .from("social_accounts")
      .select("id, user_id, username")
      .eq("platform", "x")
      .eq("platform_account_id", xUser.id)
      .eq("status", "active")
      .neq("user_id", user.id)
      .limit(1);
    if (cross && cross.length > 0) {
      console.warn(
        "[X-OAUTH-CALLBACK] rejected — X account already linked by another AIBazzlr user",
        {
          xUserId: xUser.id,
          xUsername: xUser.username,
          attemptingUser: user.id,
          ownerUser: cross[0].user_id,
        },
      );
      return redirectWithParams(target, {
        error: "x_account_already_linked",
        detail: `@${xUser.username} は別の AIBazzlr アカウントで既に連携されています。元のアカウントで連携を解除してから再度お試しください。`,
      });
    }

    // 5. Decide is_primary: only the FIRST active account for this
    // (user, platform) becomes primary. Re-connecting an existing account
    // preserves its current is_primary value so we don't accidentally
    // demote a user's chosen primary.
    const { data: existing } = await supabase
      .from("social_accounts")
      .select("id, is_primary, platform_account_id, status")
      .eq("user_id", user.id)
      .eq("platform", "x");

    const existingRows = existing ?? [];
    const sameAccount = existingRows.find(
      (a) => a.platform_account_id === xUser.id,
    );
    const otherActive = existingRows.filter(
      (a) => a.platform_account_id !== xUser.id && a.status === "active",
    );

    let isPrimary: boolean;
    if (sameAccount) {
      // Re-connecting → keep whatever it was. Defensive false fallback.
      isPrimary = Boolean(sameAccount.is_primary);
    } else {
      // Brand new connection → primary only if no other active accounts.
      isPrimary = otherActive.length === 0;
    }

    // 6. Upsert social_account
    const payload = {
      user_id: user.id,
      platform: "x" as const,
      // Both columns mirror X's user.id. platform_account_id is a Phase 4
      // NOT NULL legacy column; platform_user_id was added in Phase 6 for
      // OAuth bookkeeping. Keep them in lock-step.
      platform_account_id: xUser.id,
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

      // ★ Phase 6.1: must be explicit so the DB default (true) doesn't
      // collide with the unique partial index
      // (user_id, platform) WHERE is_primary.
      is_primary: isPrimary,

      status: "active" as const,
      last_synced_at: new Date().toISOString(),
    };

    // Defensive: even if the payload above already sets both ID columns,
    // run through syncPlatformIds in case future edits drop one of them.
    const { error: upsertError } = await supabase
      .from("social_accounts")
      .upsert(syncPlatformIds(payload), {
        // Use the legacy NOT NULL column for conflict detection — its
        // unique constraint has been in place since Phase 4. The new
        // platform_user_id always carries the same value, so re-connecting
        // the same X account still resolves correctly.
        onConflict: "user_id,platform,platform_account_id",
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
