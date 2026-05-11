import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOauthSession } from "@/lib/db/oauth-sessions";
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@/lib/oauth/x-client";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 300;

function envOrError(): { ok: true; clientId: string; redirectUri: string } | { ok: false; error: string } {
  if (!process.env.X_CLIENT_ID) return { ok: false, error: "X_CLIENT_ID is not set" };
  if (!process.env.X_CALLBACK_URL) return { ok: false, error: "X_CALLBACK_URL is not set" };
  if (!process.env.TOKEN_ENCRYPTION_KEY) return { ok: false, error: "TOKEN_ENCRYPTION_KEY is not set" };
  return {
    ok: true,
    clientId: process.env.X_CLIENT_ID,
    redirectUri: process.env.X_CALLBACK_URL,
  };
}

export async function POST(_request: NextRequest) {
  const env = envOrError();
  if (!env.ok) {
    console.error("[X-OAUTH-LOGIN] env missing:", env.error);
    return NextResponse.json(
      { error: env.error },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  try {
    await createOauthSession(supabase, {
      user_id: user.id,
      platform: "x",
      state,
      code_verifier: codeVerifier,
      redirect_after: "/dashboard/sns",
    });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[X-OAUTH-LOGIN] failed to save oauth_session", info);
    return NextResponse.json(
      { error: "Failed to start OAuth flow", debug: info },
      { status: 500 },
    );
  }

  const authUrl = buildAuthorizationUrl({
    clientId: env.clientId,
    redirectUri: env.redirectUri,
    state,
    codeChallenge,
  });

  return NextResponse.json({ redirect_url: authUrl });
}
