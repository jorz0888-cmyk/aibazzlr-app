import {
  getSocialAccountById,
  getValidAccessToken,
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
  // Allow active and the auto-recoverable states. token_invalid will be
  // bumped back to active by getValidAccessToken if the refresh succeeds.
  const refreshableStates = ["active", "expired", "token_invalid"];
  if (!refreshableStates.includes(account.status)) {
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

  // Phase 7-2: getValidAccessToken auto-refreshes the token if it's near
  // expiry. On unrecoverable failure (refresh_token dead) it also marks
  // the account as `token_invalid` so the UI can prompt re-auth.
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(supabase, account.id, userId);
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
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
