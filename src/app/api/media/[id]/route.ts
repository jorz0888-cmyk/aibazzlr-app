import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFromUserMedia } from "@/lib/media/storage";
import type { PostStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    tags?: unknown;
    ai_description?: unknown;
  };
  const patch: { tags?: string[]; ai_description?: string | null } = {};
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);
  }
  if (typeof body.ai_description === "string") {
    patch.ai_description = body.ai_description.trim() || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("media_library")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) {
    console.error("[media/:id][PATCH] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ media: data });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row } = await supabase
    .from("media_library")
    .select("storage_path, user_id")
    .eq("id", id)
    .single();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cascade-null image_url on pending drafts that referenced this media.
  // posts.media_id has ON DELETE SET NULL, but image_url is a separate
  // snapshot column populated at generation time so historical posted/
  // published rows can still render their old thumbnails after the
  // storage object is gone. We only null it for not-yet-published drafts
  // so they fail-soft to a text-only post (matches Phase 12 fail-soft).
  // Everything that isn't already published or actively in flight.
  // posted/published/posted_manually keep their snapshot URL so the
  // historical timeline can still render the thumbnail. publishing is
  // mid-flight — yanking the image now would risk a half-posted state.
  const PENDING_STATUSES: PostStatus[] = [
    "pending",
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "awaiting_manual_post",
    "queued",
    "scheduled",
    "failed",
    "cancelled",
  ];
  const { error: unlinkErr } = await supabase
    .from("posts")
    .update({ image_url: null })
    .eq("media_id", id)
    .eq("user_id", user.id)
    .in("status", PENDING_STATUSES);
  if (unlinkErr) {
    console.error("[media/:id][DELETE] unlink pending posts failed", unlinkErr);
  }

  await deleteFromUserMedia(supabase, row.storage_path);

  const { error } = await supabase
    .from("media_library")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[media/:id][DELETE] db delete failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
