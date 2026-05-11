import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteSocialAccount,
  getSocialAccountById,
} from "@/lib/db/social-accounts";
import { decryptToken } from "@/lib/oauth/encryption";
import { revokeToken } from "@/lib/oauth/x-client";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    socialAccountId?: string;
  };
  if (!body.socialAccountId) {
    return NextResponse.json(
      { error: "Missing socialAccountId" },
      { status: 400 },
    );
  }

  let account;
  try {
    account = await getSocialAccountById(supabase, body.socialAccountId);
  } catch (e) {
    const info = extractDbError(e);
    return NextResponse.json(
      { error: "Account lookup failed", debug: info },
      { status: 500 },
    );
  }

  if (!account || account.user_id !== user.id) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Best-effort: revoke at X's side (don't block deletion if it fails)
  if (
    account.access_token &&
    account.access_token_iv &&
    account.access_token_tag &&
    process.env.X_CLIENT_ID &&
    process.env.X_CLIENT_SECRET
  ) {
    try {
      const accessToken = decryptToken({
        ciphertext: account.access_token,
        iv: account.access_token_iv,
        tag: account.access_token_tag,
      });
      await revokeToken({
        token: accessToken,
        clientId: process.env.X_CLIENT_ID,
        clientSecret: process.env.X_CLIENT_SECRET,
      });
    } catch (err) {
      console.warn(
        "[X-OAUTH-DISCONNECT] revoke failed (continuing)",
        err,
      );
    }
  }

  try {
    await deleteSocialAccount(supabase, body.socialAccountId);
  } catch (e) {
    const info = extractDbError(e);
    console.error("[X-OAUTH-DISCONNECT] DB delete failed", info);
    return NextResponse.json(
      { error: "Failed to disconnect", debug: info },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
