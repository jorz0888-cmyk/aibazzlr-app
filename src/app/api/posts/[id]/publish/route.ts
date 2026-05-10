import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";
import { publishPostToX } from "@/lib/posts/publisher";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

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
  if (post.status !== "draft" && post.status !== "failed") {
    return NextResponse.json(
      {
        error: `この投稿は既に ${post.status} 状態のため再投稿できません`,
      },
      { status: 409 },
    );
  }

  // Mark publishing first so a second click can't double-post.
  await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "publishing" } as any)
    .eq("id", post.id);

  const result = await publishPostToX(supabase, post, user.id);

  if (result.ok) {
    const { error } = await supabase
      .from("posts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        status: "posted",
        posted_at: result.postedAt,
        published_at: result.postedAt,
        platform_post_id: result.tweetId,
        platform_post_url: result.url,
        external_post_id: result.tweetId,
        error_message: null,
      } as any)
      .eq("id", post.id);
    if (error) {
      const info = extractDbError(error);
      console.error("[POSTS-API/publish] post-success save failed", info);
      // Tweet went through; just report the DB hiccup.
      return NextResponse.json(
        {
          ok: true,
          warning: `投稿は成功しましたが、DB更新でエラー: ${info.message}`,
          tweet_id: result.tweetId,
          url: result.url,
        },
        { status: 200 },
      );
    }
    return NextResponse.json({
      ok: true,
      tweet_id: result.tweetId,
      url: result.url,
    });
  }

  // Failure path — revert status to 'failed' with the explanation.
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
    {
      ok: false,
      error: result.errorMessage,
      x_status: result.status,
    },
    { status: 502 },
  );
}
