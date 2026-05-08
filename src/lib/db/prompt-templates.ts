import type { PromptTemplate } from "@/lib/supabase/types";
import type { DBClient as DB } from "./_client-type";

const TABLE = "prompt_templates";

export async function listActivePromptTemplates(
  supabase: DB,
): Promise<PromptTemplate[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("industry", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function listPromptTemplatesByIndustry(
  supabase: DB,
  industry: string,
): Promise<PromptTemplate[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("industry", industry)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getPromptTemplateById(
  supabase: DB,
  id: string,
): Promise<PromptTemplate | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listIndustries(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("industry")
    .eq("is_active", true);

  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) set.add(row.industry);
  return Array.from(set).sort();
}
