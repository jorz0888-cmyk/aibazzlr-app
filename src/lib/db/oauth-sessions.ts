import type {
  OauthSession,
  OauthSessionInsert,
  Platform,
} from "@/lib/supabase/types";
import type { DBClient as DB } from "./_client-type";

const TABLE = "oauth_sessions";

export async function createOauthSession(
  supabase: DB,
  input: OauthSessionInsert,
): Promise<OauthSession> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getOauthSessionByState(
  supabase: DB,
  state: string,
  userId: string,
  platform: Platform,
): Promise<OauthSession | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("state", state)
    .eq("user_id", userId)
    .eq("platform", platform)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteOauthSession(
  supabase: DB,
  id: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
