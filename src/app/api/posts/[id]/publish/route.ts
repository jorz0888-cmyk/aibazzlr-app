import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostById } from "@/lib/db/posts";
import { publishPostToX } from "@/lib/posts/publisher";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RETRY = 3;

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
  // platform_post_id が埋まっている = X 側で投稿成功済み。
  // 何度押されても X に再送信しない (重複投稿の最終ライン)。
  if (post.platform_post_id) {
    // Self-heal: status が posted じゃないなら直す
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

  // ─── GUARD 1b: optimistic lock (atomic state transition) ───────────────
  // status を draft|failed → publishing に「条件付き」で更新する。
  // 同じ id に対する 2 つ目のリクエストは matching row が既に publishing
  // になっているので 0 行更新になり、ここで弾ける。
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
    // ─── GUARD 2: persist platform_post_id IMMEDIATELY ───────────────────
    // X 側ではツイートが既に存在する。何が何でも platform_post_id だけは
    // 保存して、以降の retry/publish が誤発火しないようにする。
    const minimalSave = await supabase
      .from("posts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        platform_post_id: result.tweetId,
        platform_post_url: result.url,
        external_post_id: result.tweetId,
      } as any)
      .eq("id", post.id);

    if (minimalSave.error) {
      // ★ Critical: X に投稿は通ったが platform_post_id すら保存できなかった
      console.error(
        "[POSTS-API/publish] CRITICAL: X posted but platform_post_id save failed",
        {
          postId: post.id,
          tweetId: result.tweetId,
          dbError: minimalSave.error,
        },
      );
      // それでもユーザーには成功を返す (X 側はツイート済なので)
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

    // ─── 続いて status / posted_at を更新 (非critical) ───────────────────
    const fullSave = await supabase
      .from("posts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        status: "posted",
        posted_at: result.postedAt,
        published_at: result.postedAt,
        error_message: null,
      } as any)
      .eq("id", post.id);

    if (fullSave.error) {
      console.error(
        "[POSTS-API/publish] status update failed (non-fatal)",
        {
          postId: post.id,
          tweetId: result.tweetId,
          dbError: fullSave.error,
        },
      );
      // platform_post_id は保存済なので二重投稿はあり得ない。
      return NextResponse.json(
        {
          ok: true,
          warning: `投稿は成功しましたが、ステータス更新で軽微なエラー: ${fullSave.error.message}`,
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
  // status を failed に戻して retry_count++。
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
