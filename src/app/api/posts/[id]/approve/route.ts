import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";
import { publishPostToX } from "@/lib/posts/publisher";
import { updatePostWithRetry } from "@/lib/db/post-update";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Approve a pending_approval post and immediately publish it to X.
 * Used by the dashboard approval modal — no token required since the
 * caller is already authenticated as the post owner.
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
  if (post.status !== "pending_approval") {
    return NextResponse.json(
      {
        error: `承認できる状態ではありません（現在: ${post.status}）`,
      },
      { status: 409 },
    );
  }

  // Lock the row before posting so a second click cannot race.
  const { data: locked } = await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "publishing" } as any)
    .eq("id", post.id)
    .eq("status", "pending_approval")
    .select("id");
  if (!locked || locked.length === 0) {
    return NextResponse.json(
      { error: "他のセッションが先に承認処理を実行しました" },
      { status: 409 },
    );
  }

  const result = await publishPostToX(supabase, post, user.id);
  if (result.ok) {
    await updatePostWithRetry(supabase, post.id, {
      platform_post_id: result.tweetId,
      platform_post_url: result.url,
      external_post_id: result.tweetId,
      status: "posted",
      posted_at: result.postedAt,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      error_message: null,
    });
    return NextResponse.json({
      ok: true,
      tweet_id: result.tweetId,
      url: result.url,
    });
  }

  await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      status: "failed",
      error_message: result.errorMessage,
      retry_count: (post.retry_count ?? 0) + 1,
    } as any)
    .eq("id", post.id);
  return NextResponse.json(
    { ok: false, error: result.errorMessage },
    { status: 502 },
  );
}
