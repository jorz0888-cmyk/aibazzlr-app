import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSocialAccountById,
  setPrimarySocialAccount,
} from "@/lib/db/social-accounts";
import { extractDbError } from "@/lib/db/error";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/social-accounts/[id]/primary
 *
 * Promote the given account to primary for its (user, platform). The DB has
 * a unique partial index (user_id, platform) WHERE is_primary, so we must
 * unset the old primary BEFORE setting the new one — `setPrimarySocialAccount`
 * does that in two steps. (Supabase PostgREST doesn't expose multi-statement
 * transactions; the temporary "no primary" window is fine because no read
 * path requires a primary to exist.)
 */
export async function PATCH(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await getSocialAccountById(supabase, id);
  if (!account || account.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (account.is_primary) {
    return NextResponse.json({ ok: true, alreadyPrimary: true });
  }

  try {
    await setPrimarySocialAccount(
      supabase,
      account.id,
      user.id,
      account.platform,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const info = extractDbError(e);
    console.error("[social-accounts/primary] failed", info);
    return NextResponse.json(
      { error: `PRIMARY 切替に失敗しました: ${info.message}`, debug: info },
      { status: 500 },
    );
  }
}
