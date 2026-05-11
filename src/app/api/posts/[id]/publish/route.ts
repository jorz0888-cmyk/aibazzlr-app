import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";
import { updatePostWithRetry } from "@/lib/db/post-update";
import { publishPostToX } from "@/lib/posts/publisher";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_RETRY = 3;
const DB_UPDATE_MAX_RETRIES = 3;

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

  // ─── GUARD 1a: already-posted check ─────────────────────────────────────
  if (post.platform_post_id) {
    if (post.status !== "posted" && post.status !== "published") {
      await supabase
        .from("posts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          status: "posted",
          posted_at: post.posted_at ?? new Date().toISOString(),
          error_message: null,
        } as any)
        .eq("id", post.id);
    }
    return NextResponse.json(
      {
        error:
          "この投稿は既に X に送信されています。重複投稿を防ぐため処理を中止しました。",
        platform_post_id: post.platform_post_id,
        platform_post_url: post.platform_post_url,
        already_posted: true,
      },
      { status: 409 },
    );
  }

  // ─── GUARD 3: retry limit ───────────────────────────────────────────────
  if ((post.retry_count ?? 0) >= MAX_RETRY) {
    return NextResponse.json(
      {
        error: `再試行回数の上限 (${MAX_RETRY} 回) に達しました。内容を編集してから再度お試しください。`,
        retry_count: post.retry_count,
      },
      { status: 429 },
    );
  }

  // ─── GUARD 1b: optimistic lock ─────────────────────────────────────────
  const { data: lockedRows, error: lockError } = await supabase
    .from("posts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "publishing" } as any)
    .eq("id", post.id)
    .eq("user_id", user.id)
    .is("platform_post_id", null)
    .in("status", ["draft", "failed"])
    .select("id");

  if (lockError) {
    const info = extractDbError(lockError);
    console.error("[POSTS-API/publish] lock failed", info);
    return NextResponse.json(
      { error: `投稿前ロックの取得に失敗: ${info.message}`, debug: info },
      { status: 500 },
    );
  }
  if (!lockedRows || lockedRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "他のリクエストが既にこの投稿を処理中、または投稿不可な状態です（重複投稿防止）",
      },
      { status: 409 },
    );
  }

  // ─── X API call ─────────────────────────────────────────────────────────
  const result = await publishPostToX(supabase, post, user.id);

  if (result.ok) {
    // ─── GUARD 2: persist platform_post_id (retried) ─────────────────────
    // If this fails after 3 tries, we still tell the user the post succeeded
    // (X side has the tweet) and the cron cleanup (every 5 min) will
    // eventually mark this row as posted once it sees platform_post_id.
    const minimalSave = await updatePostWithRetry(supabase, post.id, {
      platform_post_id: result.tweetId,
      platform_post_url: result.url,
      external_post_id: result.tweetId,
    });

    if (!minimalSave.ok) {
      console.error(
        "[POSTS-API/publish] CRITICAL: X posted but platform_post_id save failed after retries",
        { postId: post.id, tweetId: result.tweetId, lastError: minimalSave.error },
      );
      // Best-effort: try to leave an audit trail in error_message even if
      // we couldn't write platform_post_id. The cron cleanup will then
      // *not* be able to promote this to posted (no platform_post_id), so
      // it'll become failed with our message visible.
      await supabase
        .from("posts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          error_message: `X 側で投稿成功 (tweet_id=${result.tweetId}) したが、DBへのID保存に失敗: ${minimalSave.error}`,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", post.id);

      return NextResponse.json(
        {
          ok: true,
          warning:
            "Xへの投稿は成功しましたが、AIBazzlr側のID保存で問題がありました。サポートまでご連絡ください。",
          tweet_id: result.tweetId,
          url: result.url,
          critical: true,
        },
        { status: 200 },
      );
    }

    // ─── status → posted (retried) ───────────────────────────────────────
    const fullSave = await updatePostWithRetry(supabase, post.id, {
      status: "posted",
      posted_at: result.postedAt,
      error_message: null,
    });

    if (!fullSave.ok) {
      console.error(
        "[POSTS-API/publish] status update failed after retries (non-fatal)",
        { postId: post.id, tweetId: result.tweetId, lastError: fullSave.error },
      );
      // Per spec: leave platform_post_id (already saved) intact, persist
      // an error_message so the row is visible/auditable, keep status
      // as 'publishing'. The pg_cron cleanup will see status=publishing
      // + platform_post_id set + updated_at > 5min and promote to 'posted'.
      await supabase
        .from("posts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          error_message: `Post succeeded on X but DB status update failed after ${DB_UPDATE_MAX_RETRIES} retries: ${fullSave.error}`,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", post.id);

      return NextResponse.json(
        {
          ok: true,
          warning: `投稿は成功しましたが、ステータス更新で軽微なエラーが発生しました。数分以内に自動修復されます。(${fullSave.error})`,
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

  // ─── X API failure path ────────────────────────────────────────────────
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
      retry_count: (post.retry_count ?? 0) + 1,
    },
    { status: 502 },
  );
}
