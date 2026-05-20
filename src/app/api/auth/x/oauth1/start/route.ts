import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/oauth/encryption";
import {
  XOauth1Error,
  buildAuthorizeUrl,
  requestRequestToken,
} from "@/lib/posts/x-oauth1-flow";

export const runtime = "nodejs";

/**
 * Phase 15 (3-legged): step 1 of the OAuth 1.0a connect flow.
 * Generates a request_token via X, stores its secret in oauth1_pending
 * (10-min TTL), and 302s the user to X's authorize page.
 *
 * The caller (the SNS settings page's "Xと連携" button) should send the
 * user here as a top-level navigation, not a fetch — we redirect to X's
 * domain.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not authenticated → kick to login, come back here afterwards.
    const back = encodeURIComponent("/api/auth/x/oauth1/start");
    return NextResponse.redirect(
      new URL(`/login?redirect=${back}`, request.url),
    );
  }

  // Derive the callback URL from this request's origin so previews +
  // local dev work without touching env vars.
  const callbackUrl = new URL(
    "/api/auth/x/oauth1/callback",
    request.nextUrl.origin,
  ).toString();

  const redirectAfter =
    request.nextUrl.searchParams.get("redirect_after") ?? "/dashboard/sns";

  let tokens;
  try {
    tokens = await requestRequestToken(callbackUrl);
  } catch (e) {
    console.error("[oauth1/start] request_token failed", e);
    const target = new URL("/dashboard/sns", request.url);
    target.searchParams.set("error", "oauth1_request_token_failed");
    if (e instanceof XOauth1Error) {
      target.searchParams.set("detail", e.message.slice(0, 200));
    }
    return NextResponse.redirect(target);
  }

  // Persist the secret so the callback step can sign access_token request.
  const enc = encryptToken(tokens.oauthTokenSecret);
  const { error: insertErr } = await supabase
    .from("oauth1_pending")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(
      {
        oauth_token: tokens.oauthToken,
        user_id: user.id,
        oauth_token_secret_ciphertext: enc.ciphertext,
        oauth_token_secret_iv: enc.iv,
        oauth_token_secret_tag: enc.tag,
        redirect_after: redirectAfter,
      } as any,
      { onConflict: "oauth_token" },
    );
  if (insertErr) {
    console.error("[oauth1/start] pending insert failed", insertErr);
    const target = new URL("/dashboard/sns", request.url);
    target.searchParams.set("error", "oauth1_persist_failed");
    target.searchParams.set("detail", insertErr.message.slice(0, 200));
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(buildAuthorizeUrl(tokens.oauthToken));
}
