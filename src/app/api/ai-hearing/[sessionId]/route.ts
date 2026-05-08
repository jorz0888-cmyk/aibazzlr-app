import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  abandonHearingSession,
  getHearingSession,
} from "@/lib/db/ai-hearing-sessions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ sessionId: string }> };

async function authorize(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== user.id) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { supabase, session, user };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { sessionId } = await params;
  const auth = await authorize(sessionId);
  if ("error" in auth) return auth.error;
  return NextResponse.json({ session: auth.session });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { sessionId } = await params;
  const auth = await authorize(sessionId);
  if ("error" in auth) return auth.error;
  await abandonHearingSession(auth.supabase, sessionId);
  return NextResponse.json({ ok: true });
}
