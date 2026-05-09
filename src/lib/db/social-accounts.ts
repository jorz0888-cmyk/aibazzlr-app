import type {
  Platform,
  SocialAccount,
  SocialAccountInsert,
  SocialAccountUpdate,
} from "@/lib/supabase/types";
import { decryptToken, type EncryptedData } from "@/lib/oauth/encryption";
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
