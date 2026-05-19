import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a copy-paste post (status='awaiting_manual_post') as posted by the
 * user after they pasted it into X themselves. Owner-only. Idempotent: if
 * the post is already posted_manually we just return ok.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const post = await getPostById(supabase, id);
  if (!post || post.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (post.status === "posted_manually") {
    return NextResponse.json({ ok: true, already: true });
  }
  if (post.status !== "awaiting_manual_post") {
    return NextResponse.json(
      {
        error: `この投稿はコピペ待ち状態ではありません（現在: ${post.status}）`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      status: "posted_manually",
      posted_at: new Date().toISOString(),
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    } as any)
    .eq("id", post.id)
    .eq("status", "awaiting_manual_post");
  if (error) {
    console.error("[posts/:id/mark-as-posted] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
