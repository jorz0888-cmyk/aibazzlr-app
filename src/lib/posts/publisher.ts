import {
  getSocialAccountById,
  getValidAccessToken,
} from "@/lib/db/social-accounts";
import {
  buildPostUrl,
  buildTweetText,
  postToX,
  uploadImageToX,
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
    // Disable the client-side length cap — the generator already enforces
    // ai_configs.max_post_length, and for posts that slip past that the X
    // server is the final authority. Hard-coding 280 here was a regression
    // against Phase 14's per-config caps (1k / 4k / 25k for Premium tiers).
    tweetText = buildTweetText(post.content, post.hashtags ?? [], null);
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

  // Phase 12: attach the image if the draft has one. Fail-soft — if the
  // media upload fails, we still want to post the tweet as text only so
  // the user is not blocked by a transient image issue.
  let mediaIds: string[] | undefined;
  if (post.image_url) {
    try {
      const mediaId = await uploadImageToX(accessToken, post.image_url);
      mediaIds = [mediaId];
    } catch (e) {
      console.warn(
        "[publisher] X media upload failed; posting text-only",
        e instanceof Error ? e.message : e,
      );
    }
  }

  try {
    const tweet = await postToX(accessToken, tweetText, mediaIds);
    return {
      ok: true,
      tweetId: tweet.id,
      url: buildPostUrl(account.username, tweet.id),
      postedAt: new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof XApiError) {
      // Append the raw X detail so the dashboard surfaces the actual
      // reason (e.g. "Your client app is not configured with the
      // appropriate oauth1 app permissions for this endpoint" — the
      // most common 403 cause for new X dev portal apps).
      const detail = e.detail ? ` | X詳細: ${e.detail}` : "";
      return {
        ok: false,
        errorMessage: `${e.message}${detail}`,
        status: e.status,
      };
    }
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      status: null,
    };
  }
}
