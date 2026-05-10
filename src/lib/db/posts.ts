import type {
  Post,
  PostInsert,
  PostStatus,
  PostUpdate,
} from "@/lib/supabase/types";
import { applyPostDefaults } from "./post-defaults";
import type { DBClient as DB } from "./_client-type";

const TABLE = "posts";

export type ListPostsOptions = {
  status?: PostStatus | PostStatus[];
  limit?: number;
  offset?: number;
};

export async function listPostsByUser(
  supabase: DB,
  userId: string,
  options: ListPostsOptions = {},
): Promise<Post[]> {
  const { status, limit = 50, offset = 0 } = options;

  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = Array.isArray(status)
      ? query.in("status", status)
      : query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function countPostsByUser(
  supabase: DB,
  userId: string,
  status?: PostStatus,
): Promise<number> {
  let query = supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (status) query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function getPostById(
  supabase: DB,
  id: string,
): Promise<Post | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createPost(
  supabase: DB,
  input: PostInsert,
): Promise<Post> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(applyPostDefaults(input))
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updatePost(
  supabase: DB,
  id: string,
  patch: PostUpdate,
): Promise<Post> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deletePost(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}

export async function cancelScheduledPost(
  supabase: DB,
  id: string,
): Promise<Post> {
  return updatePost(supabase, id, {
    status: "cancelled",
    scheduled_at: null,
  });
}
