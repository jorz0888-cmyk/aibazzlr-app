import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHearingSession } from "@/lib/db/ai-hearing-sessions";
import { HEARING_OPENING_MESSAGE } from "@/lib/ai/hearing-prompts";
import type { HearingMessage } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    industry?: string;
  };

  const opening: HearingMessage = {
    role: "assistant",
    content: HEARING_OPENING_MESSAGE,
    created_at: new Date().toISOString(),
  };

  try {
    const session = await createHearingSession(supabase, {
      user_id: user.id,
      status: "in_progress",
      industry: body.industry ?? null,
      messages: [opening],
      current_step: 1,
      extracted_data: null,
      finalized_prompt: null,
      ai_config_id: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (e) {
    console.error("[hearing/start]", e);
    return NextResponse.json(
      { error: "Failed to start hearing session" },
      { status: 500 },
    );
  }
}
