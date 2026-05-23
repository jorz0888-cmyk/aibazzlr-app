import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { encryptToken, decryptToken } from "@/lib/oauth/encryption";
import {
  XOauth1Error,
  exchangeForAccessToken,
} from "@/lib/posts/x-oauth1-flow";
import { syncPlatformIds } from "@/lib/db/social-accounts";

export const runtime = "nodejs";

function redirectWithParams(
  url: URL,
  params: Record<string, string | null | undefined>,
) {
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url);
}

/**
 * Phase 15 (3-legged): step 3 of the OAuth 1.0a connect flow.
 * X sent the user back here with ?oauth_token + ?oauth_verifier (or
 * ?denied=... if the user clicked Cancel on X's authorize page).
 * We look up the request_token's secret from oauth1_pending, exchange
 * for a long-lived access_token, and upsert social_accounts.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const target = new URL("/dashboard/sns", request.url);

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // User clicked "Cancel" on X's authorize screen.
  const denied = request.nextUrl.searchParams.get("denied");
  if (denied) {
    return redirectWithParams(target, {
      error: "oauth1_denied",
      detail: denied,
    });
  }

  const oauthToken = request.nextUrl.searchParams.get("oauth_token");
  const oauthVerifier = request.nextUrl.searchParams.get("oauth_verifier");
  if (!oauthToken || !oauthVerifier) {
    return redirectWithParams(target, { error: "oauth1_missing_params" });
  }

  // Fetch the pending row created in /start.
  const { data: pending, error: pendingErr } = await supabase
    .from("oauth1_pending")
    .select("*")
    .eq("oauth_token", oauthToken)
    .maybeSingle();
  if (pendingErr) {
    console.error("[oauth1/callback] pending lookup failed", pendingErr);
    return redirectWithParams(target, {
      error: "oauth1_pending_lookup",
      detail: pendingErr.message.slice(0, 200),
    });
  }
  if (!pending) {
    return redirectWithParams(target, { error: "oauth1_pending_missing" });
  }
  if (pending.user_id !== user.id) {
    console.warn("[oauth1/callback] pending owner mismatch", {
      pendingUser: pending.user_id,
      currentUser: user.id,
    });
    return redirectWithParams(target, { error: "oauth1_pending_mismatch" });
  }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    return redirectWithParams(target, { error: "oauth1_pending_expired" });
  }

  const requestTokenSecret = decryptToken({
    ciphertext: pending.oauth_token_secret_ciphertext,
    iv: pending.oauth_token_secret_iv,
    tag: pending.oauth_token_secret_tag,
  });

  let access;
  try {
    access = await exchangeForAccessToken(
      oauthToken,
      requestTokenSecret,
      oauthVerifier,
    );
  } catch (e) {
    console.error("[oauth1/callback] access_token exchange failed", e);
    return redirectWithParams(target, {
      error: "oauth1_access_token_failed",
      detail:
        e instanceof XOauth1Error
          ? e.message.slice(0, 200)
          : e instanceof Error
            ? e.message.slice(0, 200)
            : "unknown",
    });
  }

  // Phase 18 cross-user check (mirrors the OAuth 2.0 callback). The
  // partial unique index would reject the upsert with 23505 anyway,
  // but a pre-check lets us return a clear JP message instead of a
  // generic "save_failed" and skip the (expensive) token encryption.
  const admin = createAdminClient();
  const { data: cross } = await admin
    .from("social_accounts")
    .select("id, user_id, username")
    .eq("platform", "x")
    .eq("platform_account_id", access.userId)
    .eq("status", "active")
    .neq("user_id", user.id)
    .limit(1);
  if (cross && cross.length > 0) {
    console.warn(
      "[oauth1/callback] rejected — X account already linked by another AIBazzlr user",
      {
        xUserId: access.userId,
        xUsername: access.screenName,
        attemptingUser: user.id,
        ownerUser: cross[0].user_id,
      },
    );
    return redirectWithParams(target, {
      error: "x_account_already_linked",
      detail: `@${access.screenName} は別の AIBazzlr アカウントで既に連携されています。元のアカウントで連携を解除してから再度お試しください。`,
    });
  }

  // Encrypt both halves of the long-lived OAuth 1.0a token pair.
  const encToken = encryptToken(access.oauthToken);
  const encSecret = encryptToken(access.oauthTokenSecret);

  // Mirror the OAuth 2.0 callback's is_primary logic: keep an existing
  // account's primary flag, only promote a brand-new connection if the
  // user has no other active X account yet.
  const { data: existing } = await supabase
    .from("social_accounts")
    .select("id, is_primary, platform_account_id, status")
    .eq("user_id", user.id)
    .eq("platform", "x");
  const rows = existing ?? [];
  const sameAccount = rows.find((a) => a.platform_account_id === access.userId);
  const otherActive = rows.filter(
    (a) => a.platform_account_id !== access.userId && a.status === "active",
  );
  const isPrimary = sameAccount
    ? Boolean(sameAccount.is_primary)
    : otherActive.length === 0;

  // Upsert the social_account with the new OAuth 1.0a tokens. We also
  // clear the legacy OAuth 2.0 fields so the publisher's resolveXAuth
  // doesn't see stale OAuth2 tokens and pick the wrong path.
  const payload = {
    user_id: user.id,
    platform: "x" as const,
    platform_account_id: access.userId,
    platform_user_id: access.userId,
    username: access.screenName,

    oauth1_access_token: encToken.ciphertext,
    oauth1_access_token_iv: encToken.iv,
    oauth1_access_token_tag: encToken.tag,
    oauth1_access_token_secret: encSecret.ciphertext,
    oauth1_access_token_secret_iv: encSecret.iv,
    oauth1_access_token_secret_tag: encSecret.tag,

    // OAuth 1.0a User Context tokens are long-lived; no expiry/refresh.
    // Keep the legacy OAuth2 fields if they were there — resolveXAuth
    // prefers OAuth 1.0a when present, so coexistence is fine.
    token_type: "oauth1",

    is_primary: isPrimary,
    status: "active" as const,
    last_synced_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from("social_accounts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(syncPlatformIds(payload) as any, {
      onConflict: "user_id,platform,platform_account_id",
    });
  if (upsertErr) {
    console.error("[oauth1/callback] upsert failed", upsertErr);
    return redirectWithParams(target, {
      error: "oauth1_save_failed",
      detail: upsertErr.message.slice(0, 200),
    });
  }

  // Best-effort delete of the pending row + any expired ones the user owns.
  await supabase
    .from("oauth1_pending")
    .delete()
    .eq("user_id", user.id)
    .or(`oauth_token.eq.${oauthToken},expires_at.lt.${new Date().toISOString()}`);

  const redirectAfter = pending.redirect_after ?? "/dashboard/sns";
  const final = new URL(redirectAfter, request.url);
  final.searchParams.set("connected", "true");
  final.searchParams.set("username", access.screenName);
  return NextResponse.redirect(final);
}
