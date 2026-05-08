import type {
  AiHearingSession,
  AiHearingSessionInsert,
  AiHearingSessionUpdate,
} from "@/lib/supabase/types";
import type { DBClient as DB } from "./_client-type";

const TABLE = "ai_hearing_sessions";

export async function listHearingSessionsByUser(
  supabase: DB,
  userId: string,
): Promise<AiHearingSession[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getHearingSession(
  supabase: DB,
  id: string,
): Promise<AiHearingSession | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createHearingSession(
  supabase: DB,
  input: AiHearingSessionInsert,
): Promise<AiHearingSession> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateHearingSession(
  supabase: DB,
  id: string,
  patch: AiHearingSessionUpdate,
): Promise<AiHearingSession> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function abandonHearingSession(
  supabase: DB,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "abandoned" })
    .eq("id", id);
  if (error) throw error;
}
