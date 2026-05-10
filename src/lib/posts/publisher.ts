import {
  getDecryptedAccessToken,
  getSocialAccountById,
} from "@/lib/db/social-accounts";
import {
  buildPostUrl,
  buildTweetText,
  postToX,
  XApiError,
} from "@/lib/posts/x-api";
import type { Post } from "@/lib/supabase/types";
import type { DBClient } from "@/lib/db/_client-type";

export type PublishResult =
  | {
      ok: true;
      tweetId: string;
      url: string;
      postedAt: string;
    }
  | {
      ok: false;
      errorMessage: string;
      status: number | null;
    };

/**
 * Publish a draft to X. Caller is responsible for ownership checks and for
 * persisting the result back to the posts row.
 */
export async function publishPostToX(
  supabase: DBClient,
  post: Post,
  userId: string,
): Promise<PublishResult> {
  if (!post.social_account_id) {
    return {
      ok: false,
      errorMessage: "投稿先SNSアカウントが指定されていません",
      status: null,
    };
  }

  const account = await getSocialAccountById(supabase, post.social_account_id);
  if (!account || account.user_id !== userId) {
    return {
      ok: false,
      errorMessage: "投稿先SNSアカウントが見つかりません",
      status: null,
    };
  }
  if (account.platform !== "x") {
    return {
      ok: false,
      errorMessage: `現在は X のみ投稿できます（指定: ${account.platform}）`,
      status: null,
    };
  }
  if (account.status !== "active") {
    return {
      ok: false,
      errorMessage: `投稿先アカウントが利用不可状態です（${account.status}）`,
      status: null,
    };
  }

  let tweetText: string;
  try {
    tweetText = buildTweetText(post.content, post.hashtags ?? []);
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      status: null,
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getDecryptedAccessToken(
      supabase,
      account.id,
      userId,
    );
  } catch (e) {
    return {
      ok: false,
      errorMessage: `アクセストークンの復号化に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      status: null,
    };
  }
  if (!accessToken) {
    return {
      ok: false,
      errorMessage:
        "アクセストークンが見つかりませんでした。X連携を再度実行してください。",
      status: null,
    };
  }

  try {
    const tweet = await postToX(accessToken, tweetText);
    return {
      ok: true,
      tweetId: tweet.id,
      url: buildPostUrl(account.username, tweet.id),
      postedAt: new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof XApiError) {
      return { ok: false, errorMessage: e.message, status: e.status };
    }
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      status: null,
    };
  }
}
