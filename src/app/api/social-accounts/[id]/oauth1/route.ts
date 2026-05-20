import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/oauth/encryption";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  access_token?: string;
  access_token_secret?: string;
  /** Pass `true` to clear the stored OAuth 1.0a tokens. */
  clear?: boolean;
};

/**
 * Phase 15: manual entry for OAuth 1.0a User Context tokens issued in the
 * X Developer Portal ("Access Token & Secret" section). Owner-only.
 *
 * Beta workflow:
 *   1. Admin opens https://developer.x.com/en/portal/projects-and-apps,
 *      picks the AIBazzlr App, scrolls to "Authentication Tokens", clicks
 *      "Generate" under "Access Token and Secret" for the logged-in X user.
 *   2. Admin POSTs the two values to this endpoint with the account id:
 *        curl -X POST .../api/social-accounts/<id>/oauth1 \
 *          -H 'Content-Type: application/json' \
 *          --cookie '<session>' \
 *          -d '{"access_token":"...","access_token_secret":"..."}'
 *   3. publisher.ts picks the OAuth 1.0a path automatically the next time
 *      that account publishes.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;

  // Ownership check.
  const { data: account } = await supabase
    .from("social_accounts")
    .select("id, user_id")
    .eq("id", id)
    .single();
  if (!account || account.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.clear === true) {
    const { error } = await supabase
      .from("social_accounts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        oauth1_access_token: null,
        oauth1_access_token_iv: null,
        oauth1_access_token_tag: null,
        oauth1_access_token_secret: null,
        oauth1_access_token_secret_iv: null,
        oauth1_access_token_secret_tag: null,
      } as any)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      console.error("[social-accounts/oauth1] clear failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, cleared: true });
  }

  const token = (body.access_token ?? "").trim();
  const secret = (body.access_token_secret ?? "").trim();
  if (!token || !secret) {
    return NextResponse.json(
      {
        error:
          "access_token と access_token_secret は必須です（または clear:true を指定）",
      },
      { status: 400 },
    );
  }

  const encToken = encryptToken(token);
  const encSecret = encryptToken(secret);

  const { error } = await supabase
    .from("social_accounts")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      oauth1_access_token: encToken.ciphertext,
      oauth1_access_token_iv: encToken.iv,
      oauth1_access_token_tag: encToken.tag,
      oauth1_access_token_secret: encSecret.ciphertext,
      oauth1_access_token_secret_iv: encSecret.iv,
      oauth1_access_token_secret_tag: encSecret.tag,
      // Ensure status is active so publisher will accept the account.
      status: "active",
    } as any)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[social-accounts/oauth1] update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
