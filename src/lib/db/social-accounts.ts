import type {
  Platform,
  SocialAccount,
  SocialAccountInsert,
  SocialAccountUpdate,
} from "@/lib/supabase/types";
import { decryptToken, encryptToken, type EncryptedData } from "@/lib/oauth/encryption";
import { refreshXAccessToken, XRefreshError } from "@/lib/oauth/x-client";
import type { DBClient as DB } from "./_client-type";

const TABLE = "social_accounts";

export async function listSocialAccountsByUser(
  supabase: DB,
  userId: string,
): Promise<SocialAccount[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("connected_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getSocialAccountById(
  supabase: DB,
  id: string,
): Promise<SocialAccount | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Ensure platform_user_id (Phase 6) and platform_account_id (Phase 4 legacy
 * NOT NULL) always carry the same value. Call this on every INSERT/UPSERT
 * site so we never trip the legacy column's not-null constraint again.
 */
export function syncPlatformIds<
  T extends {
    platform_user_id?: string | null;
    platform_account_id?: string | null;
  },
>(input: T): T {
  const id = input.platform_user_id ?? input.platform_account_id ?? null;
  if (!id) return input;
  return {
    ...input,
    platform_user_id: id,
    platform_account_id: id,
  };
}

export async function createSocialAccount(
  supabase: DB,
  input: SocialAccountInsert,
): Promise<SocialAccount> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(syncPlatformIds(input))
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateSocialAccount(
  supabase: DB,
  id: string,
  patch: SocialAccountUpdate,
): Promise<SocialAccount> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSocialAccount(
  supabase: DB,
  id: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Phase 6 helper: list a user's connected accounts with display details.
 * Currently identical to listSocialAccountsByUser but reserved as the entry
 * point for future joins (e.g. tweet counts).
 */
export async function listForUserWithDetails(
  supabase: DB,
  userId: string,
): Promise<SocialAccount[]> {
  return listSocialAccountsByUser(supabase, userId);
}

/**
 * Get the active connected account for a specific platform (e.g. for posting).
 */
export async function getActiveByPlatform(
  supabase: DB,
  userId: string,
  platform: Platform,
): Promise<SocialAccount | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("status", "active")
    .order("is_primary", { ascending: false })
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Decrypt and return the access_token for a given social_account.
 * Caller is responsible for verifying ownership (user_id) before invoking.
 */
export async function getDecryptedAccessToken(
  supabase: DB,
  socialAccountId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "access_token, access_token_iv, access_token_tag, user_id",
    )
    .eq("id", socialAccountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (
    !data?.access_token ||
    !data.access_token_iv ||
    !data.access_token_tag
  ) {
    return null;
  }
  const enc: EncryptedData = {
    ciphertext: data.access_token,
    iv: data.access_token_iv,
    tag: data.access_token_tag,
  };
  return decryptToken(enc);
}

/**
 * Phase 7-2: return a still-valid access_token for the given account.
 *
 * If `token_expires_at` is within 5 minutes of now (or null), we automatically
 * call X's refresh endpoint, persist the rotated tokens encrypted, and return
 * the fresh access_token.
 *
 * On unrecoverable refresh failures (refresh_token dead) the account is
 * marked `status = 'token_invalid'` so the UI can prompt the user to
 * re-authenticate. Transient failures (network, X 5xx) leave the status
 * untouched and just throw.
 */
export async function getValidAccessToken(
  supabase: DB,
  socialAccountId: string,
  userId: string,
): Promise<string> {
  const { data: account, error } = await supabase
    .from("social_accounts")
    .select("*")
    .eq("id", socialAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!account) {
    throw new Error("Social account not found or unauthorized");
  }

  if (
    account.status !== "active" &&
    account.status !== "expired" &&
    account.status !== "token_invalid"
  ) {
    throw new Error(`Account is not refreshable (status: ${account.status})`);
  }

  // 1. Decide if a refresh is needed (5 minutes of slack).
  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at)
    : null;
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    !expiresAt ||
    expiresAt < fiveMinutesFromNow ||
    account.status === "token_invalid";

  if (
    !needsRefresh &&
    account.access_token &&
    account.access_token_iv &&
    account.access_token_tag
  ) {
    return decryptToken({
      ciphertext: account.access_token,
      iv: account.access_token_iv,
      tag: account.access_token_tag,
    });
  }

  // 2. Need a refresh.
  if (
    !account.refresh_token ||
    !account.refresh_token_iv ||
    !account.refresh_token_tag
  ) {
    // Mark token_invalid so the UI can prompt re-auth.
    await supabase
      .from("social_accounts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ status: "token_invalid" } as any)
      .eq("id", socialAccountId);
    throw new Error(
      "X認証の有効期限が切れました。SNS連携画面から再連携してください。",
    );
  }

  console.log("[X-TOKEN-REFRESH] Refreshing", {
    socialAccountId,
    userId,
    expiresAt: expiresAt?.toISOString() ?? null,
    reason: !expiresAt
      ? "no_expiry"
      : account.status === "token_invalid"
        ? "previously_invalid"
        : "near_or_past_expiry",
  });

  let refreshed;
  try {
    const decryptedRefresh = decryptToken({
      ciphertext: account.refresh_token,
      iv: account.refresh_token_iv,
      tag: account.refresh_token_tag,
    });
    refreshed = await refreshXAccessToken(decryptedRefresh);
  } catch (e) {
    const isFatal = e instanceof XRefreshError && e.fatal;
    console.error("[X-TOKEN-REFRESH] Failed", {
      socialAccountId,
      fatal: isFatal,
      message: e instanceof Error ? e.message : String(e),
    });

    if (isFatal) {
      await supabase
        .from("social_accounts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          status: "token_invalid",
          last_synced_at: new Date().toISOString(),
        } as any)
        .eq("id", socialAccountId);
      throw new Error(
        "X認証の有効期限が切れ、自動更新も失敗しました。SNS連携画面から再連携してください。",
      );
    }
    throw new Error(
      `Xの認証トークン更新で一時的なエラーが発生しました。再試行してください: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // 3. Encrypt + persist.
  const encAccess = encryptToken(refreshed.accessToken);
  const encRefresh = encryptToken(refreshed.refreshToken);
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

  const { error: updateError } = await supabase
    .from("social_accounts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      access_token: encAccess.ciphertext,
      access_token_iv: encAccess.iv,
      access_token_tag: encAccess.tag,
      refresh_token: encRefresh.ciphertext,
      refresh_token_iv: encRefresh.iv,
      refresh_token_tag: encRefresh.tag,
      token_expires_at: newExpiresAt.toISOString(),
      last_synced_at: new Date().toISOString(),
      status: "active",
      scopes: refreshed.scope ? refreshed.scope.split(" ") : account.scopes,
    } as any)
    .eq("id", socialAccountId);

  if (updateError) {
    console.error("[X-TOKEN-REFRESH] DB update failed", updateError);
    throw new Error("トークン更新の保存に失敗しました");
  }

  console.log("[X-TOKEN-REFRESH] Success", {
    socialAccountId,
    newExpiresAt: newExpiresAt.toISOString(),
  });

  return refreshed.accessToken;
}

export async function setPrimarySocialAccount(
  supabase: DB,
  id: string,
  userId: string,
  platform: SocialAccount["platform"],
): Promise<void> {
  // Unset previous primary on this (user, platform)
  const { error: e1 } = await supabase
    .from(TABLE)
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("platform", platform);
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from(TABLE)
    .update({ is_primary: true })
    .eq("id", id);
  if (e2) throw e2;
}
