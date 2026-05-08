import type {
  SocialAccount,
  SocialAccountInsert,
  SocialAccountUpdate,
} from "@/lib/supabase/types";
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

export async function createSocialAccount(
  supabase: DB,
  input: SocialAccountInsert,
): Promise<SocialAccount> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
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
