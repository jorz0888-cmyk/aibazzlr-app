import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Flip a manually-created draft into awaiting_manual_post so it appears in
 * the dashboard timeline with the copy/open/done buttons. Used when the
 * user picks "コピペで投稿" on the manual publish dialog — we transition
 * status here, then the same modal swaps to copy-paste actions, but if the
 * user closes the dialog before clicking "投稿しました" the post is still
 * tracked correctly on the dashboard.
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
  // Idempotent: already awaiting → no-op.
  if (post.status === "awaiting_manual_post") {
    return NextResponse.json({ ok: true, already: true });
  }
  // Only allow this transition from states where the post has not yet hit X.
  if (!["draft", "failed", "pending_approval"].includes(post.status)) {
    return NextResponse.json(
      {
        error: `この状態からはコピペ投稿に切り替えできません（現在: ${post.status}）`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "awaiting_manual_post" } as any)
    .eq("id", post.id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[posts/:id/mark-as-awaiting-manual] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
