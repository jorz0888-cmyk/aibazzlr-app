import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deletePost,
  getPostById,
  updatePost,
} from "@/lib/db/posts";
import { extractDbError } from "@/lib/db/error";
import type { PostUpdate } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function authorize(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const post = await getPostById(supabase, id);
  if (!post || post.user_id !== user.id) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { supabase, user, post };
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  if (auth.post.status !== "draft") {
    return NextResponse.json(
      { error: "ドラフト以外は編集できません" },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    content?: string;
    hashtags?: unknown;
    theme?: string | null;
  };

  const patch: PostUpdate = {};
  if (typeof body.content === "string") patch.content = body.content;
  if (Array.isArray(body.hashtags)) {
    patch.hashtags = body.hashtags
      .map((h) => (typeof h === "string" ? h.trim() : ""))
      .filter(Boolean);
  }
  if (body.theme === null || typeof body.theme === "string")
    patch.theme = body.theme ?? null;

  try {
    const updated = await updatePost(auth.supabase, id, patch);
    return NextResponse.json({ post: updated });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[POSTS-API/PATCH] failed", info);
    return NextResponse.json(
      { error: `更新に失敗しました: ${info.message}`, debug: info },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  // Statuses safe to delete from the UI. `posted`/`published` rows are kept
  // for history; `publishing` could be racing with X API and shouldn't be
  // nuked mid-flight.
  const deletable = ["draft", "failed", "cancelled"];
  if (!deletable.includes(auth.post.status)) {
    return NextResponse.json(
      {
        error: `この投稿は削除できません（status: ${auth.post.status}）`,
      },
      { status: 409 },
    );
  }

  try {
    await deletePost(auth.supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const info = extractDbError(e);
    return NextResponse.json(
      { error: `削除に失敗しました: ${info.message}`, debug: info },
      { status: 500 },
    );
  }
}
