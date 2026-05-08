import type {
  AiConfig,
  AiConfigInsert,
  AiConfigUpdate,
} from "@/lib/supabase/types";
import type { DBClient as DB } from "./_client-type";

const TABLE = "ai_configs";

export async function listAiConfigsByUser(
  supabase: DB,
  userId: string,
): Promise<AiConfig[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getAiConfigById(
  supabase: DB,
  id: string,
): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getDefaultAiConfig(
  supabase: DB,
  userId: string,
): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createAiConfig(
  supabase: DB,
  input: AiConfigInsert,
): Promise<AiConfig> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateAiConfig(
  supabase: DB,
  id: string,
  patch: AiConfigUpdate,
): Promise<AiConfig> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAiConfig(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

export async function setDefaultAiConfig(
  supabase: DB,
  id: string,
  userId: string,
): Promise<void> {
  const { error: e1 } = await supabase
    .from(TABLE)
    .update({ is_default: false })
    .eq("user_id", userId);
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from(TABLE)
    .update({ is_default: true })
    .eq("id", id);
  if (e2) throw e2;
}
