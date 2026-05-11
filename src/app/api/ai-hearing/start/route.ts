import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openingMessageFor } from "@/lib/ai/hearing-prompts";
import {
  normalizeAccountMode,
  type HearingMessage,
} from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Build a user-facing error message that surfaces the actual Postgres / RLS
 * error rather than the opaque "Failed to start hearing session".
 */
function describeDbError(e: unknown): string {
  if (e && typeof e === "object") {
    const obj = e as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts: string[] = [];
    if (typeof obj.code === "string" && obj.code) parts.push(`[${obj.code}]`);
    if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
    if (typeof obj.details === "string" && obj.details) parts.push(obj.details);
    if (typeof obj.hint === "string" && obj.hint)
      parts.push(`hint: ${obj.hint}`);
    if (parts.length > 0) return parts.join(" ");
  }
  if (e instanceof Error) return e.message;
  return "詳細不明のエラー";
}

export async function POST(request: NextRequest) {
  // 1. Auth ----------------------------------------------------------------
  let supabase;
  try {
    supabase = await createClient();
  } catch (e) {
    console.error("[hearing/start] supabase client init failed", e);
    return NextResponse.json(
      {
        error: `Supabaseクライアントの初期化に失敗しました: ${describeDbError(e)}`,
      },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      {
        error:
          "認証セッションの取得に失敗しました。再度ログインしてからお試しください。",
      },
      { status: 401 },
    );
  }

  // 2. Body ----------------------------------------------------------------
  const body = (await request.json().catch(() => ({}))) as {
    industry?: string | null;
    account_mode?: string;
  };

  const accountMode = normalizeAccountMode(body.account_mode);

  const opening: HearingMessage = {
    role: "assistant",
    content: openingMessageFor(accountMode),
    created_at: new Date().toISOString(),
  };

  // 3. Insert (minimal payload — let DB defaults handle status, current_step,
  //    started_at, completed_at, extracted_data, finalized_prompt, ai_config_id) -----
  const insertPayload = {
    user_id: user.id,
    industry: body.industry ?? null,
    account_mode: accountMode,
    messages: [opening],
  };

  const { data, error } = await supabase
    .from("ai_hearing_sessions")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    console.error("[hearing/start] insert failed", {
      error,
      payload: insertPayload,
      userId: user.id,
    });
    return NextResponse.json(
      {
        error: `セッション作成に失敗: ${describeDbError(error)}`,
        debug: {
          code: (error as { code?: string }).code ?? null,
          hint: (error as { hint?: string }).hint ?? null,
        },
      },
      { status: 500 },
    );
  }

  if (!data?.id) {
    return NextResponse.json(
      { error: "セッションは作成されましたがIDが返されませんでした" },
      { status: 500 },
    );
  }

  // 4. Best-effort: bump current_step to 1 (skip silently if column missing) -
  await supabase
    .from("ai_hearing_sessions")
    .update({ current_step: 1 })
    .eq("id", data.id)
    .then(({ error: stepErr }) => {
      if (stepErr) {
        console.warn("[hearing/start] current_step update skipped", stepErr);
      }
    });

  return NextResponse.json({ sessionId: data.id });
}
