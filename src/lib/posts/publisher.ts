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
  type XAuth,
} from "@/lib/posts/x-api";
import { readEnvOauth1Consumer } from "@/lib/posts/oauth1";
import { decryptToken } from "@/lib/oauth/encryption";
import { getAiConfigById } from "@/lib/db/ai-configs";
import {
  truncateRenderedTweet,
  weightedRenderedTweet,
} from "@/lib/posts/x-text";
import type { Post, SocialAccount } from "@/lib/supabase/types";
import type { DBClient } from "@/lib/db/_client-type";

/**
 * Non-Premium X account hard cap: 280 weighted characters. We use this
 * as the absolute upper bound for the publisher pre-send guard so a
 * config with a too-large max_post_length still can't blow X's actual
 * limit. Premium / Premium+ users with larger caps are handled by
 * respecting their config-level max_post_length instead.
 */
const X_FREE_TIER_WEIGHTED_CAP = 280;

/**
 * Pick the right X auth for an account. When the row has OAuth 1.0a tokens
 * stored (Phase 15) and X_CONSUMER_KEY/SECRET are present in the env, we
 * use the OAuth 1.0a path that n8n proved works against both /2/tweets
 * and /1.1/media/upload. Otherwise fall through to the existing OAuth 2.0
 * Bearer flow.
 */
async function resolveXAuth(
  supabase: DBClient,
  account: SocialAccount,
  userId: string,
): Promise<XAuth> {
  const consumer = readEnvOauth1Consumer();
  if (
    consumer &&
    account.oauth1_access_token &&
    account.oauth1_access_token_iv &&
    account.oauth1_access_token_tag &&
    account.oauth1_access_token_secret &&
    account.oauth1_access_token_secret_iv &&
    account.oauth1_access_token_secret_tag
  ) {
    const accessToken = decryptToken({
      ciphertext: account.oauth1_access_token,
      iv: account.oauth1_access_token_iv,
      tag: account.oauth1_access_token_tag,
    });
    const accessTokenSecret = decryptToken({
      ciphertext: account.oauth1_access_token_secret,
      iv: account.oauth1_access_token_secret_iv,
      tag: account.oauth1_access_token_secret_tag,
    });
    return {
      kind: "oauth1",
      creds: {
        consumerKey: consumer.consumerKey,
        consumerSecret: consumer.consumerSecret,
        accessToken,
        accessTokenSecret,
      },
    };
  }
  const accessToken = await getValidAccessToken(supabase, account.id, userId);
  // Diagnosis 2026-05-22: also pass the stored scopes so x-api.ts can log
  // them next to the 403 dump. Lets us spot "missing media.write" without
  // a separate DB read at the call site.
  return { kind: "oauth2", accessToken, scopes: account.scopes };
}

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

  // 2026-05-22 root-cause fix: every X failure traceable to length was
  // a JS-`.length` vs X-weighted-count mismatch. Run the same weighted
  // counter X uses *before* we send, and if it's over the cap, trim
  // the body (preserving hashtags) until it fits. This is the last
  // line of defence — the generator already tries to land under the
  // cap, but image_url, hashtag overflow, etc. can still push it over.
  //
  // Effective cap: min(ai_config.max_post_length, 280 weighted). The
  // 280-weighted ceiling protects Free-tier X accounts from ever
  // sending more than X will accept, regardless of how high the user
  // raised the config knob. Premium tier handling is deferred — when
  // we add a per-account `x_plan` field we'll lift the ceiling
  // conditionally here.
  let originalContent = post.content;
  let originalHashtags = post.hashtags ?? [];
  let configuredCap = X_FREE_TIER_WEIGHTED_CAP;
  if (post.ai_config_id) {
    const cfg = await getAiConfigById(supabase, post.ai_config_id);
    if (cfg?.max_post_length) {
      configuredCap = Math.min(cfg.max_post_length, X_FREE_TIER_WEIGHTED_CAP);
    }
  }
  const initialWeighted = weightedRenderedTweet(
    originalContent,
    originalHashtags,
  );
  const trimmed = truncateRenderedTweet(
    originalContent,
    originalHashtags,
    configuredCap,
  );
  if (trimmed.truncated) {
    console.warn("[publisher] tweet over weighted cap — truncated", {
      post_id: post.id,
      cap: configuredCap,
      original_weighted: initialWeighted,
      trimmed_weighted: weightedRenderedTweet(
        trimmed.content,
        trimmed.hashtags,
      ),
      dropped_hashtags:
        trimmed.hashtags.length < originalHashtags.length,
    });
  }
  let tweetText: string;
  try {
    // Length enforcement is now upstream of buildTweetText (above) using
    // X's weighted counter. Disable buildTweetText's own JS-length cap so
    // we don't double-validate with the wrong metric.
    tweetText = buildTweetText(trimmed.content, trimmed.hashtags, null);
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      status: null,
    };
  }

  // Phase 7-2 + Phase 15: prefer OAuth 1.0a when oauth1 tokens are stored
  // on the account; otherwise fall back to the OAuth 2.0 refresh-aware path.
  let auth: XAuth;
  try {
    auth = await resolveXAuth(supabase, account, userId);
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : String(e),
      status: null,
    };
  }
  console.log("[publisher] using X auth", {
    accountId: account.id,
    username: account.username,
    kind: auth.kind,
  });

  // Phase 12: attach the image if the draft has one. Fail-soft — if the
  // media upload fails, we still want to post the tweet as text only so
  // the user is not blocked by a transient image issue.
  let mediaIds: string[] | undefined;
  if (post.image_url) {
    try {
      const mediaId = await uploadImageToX(auth, post.image_url);
      mediaIds = [mediaId];
    } catch (e) {
      console.warn(
        "[publisher] X media upload failed; posting text-only",
        e instanceof Error ? e.message : e,
      );
    }
  }

  try {
    const tweet = await postToX(auth, tweetText, mediaIds);
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
