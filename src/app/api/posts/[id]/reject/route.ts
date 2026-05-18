import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
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
  if (post.status !== "pending_approval") {
    return NextResponse.json(
      { error: `この投稿は承認待ち状態ではありません（現在: ${post.status}）` },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: string;
  };

  const { error } = await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      status: "rejected",
      rejection_reason: body.reason ?? null,
    } as any)
    .eq("id", post.id);
  if (error) {
    console.error("[posts/:id/reject] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
