import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { generateContentPillars, slugifyPillarName } from "@/lib/posts/pillars";
import type { ContentPillar } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — fetch current pillars (small enough to inline; client reads
 * via the config page server fetch, so this exists mostly for the UI
 * to refresh after a regenerate without a full router.refresh()).
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ pillars: config.content_pillars ?? [] });
}

/**
 * POST — regenerate pillars from scratch via the LLM. Overwrites the
 * stored array. Caller-friendly: returns the new array on success so
 * the UI doesn't need a follow-up read.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let pillars: ContentPillar[];
  try {
    pillars = await generateContentPillars(config);
  } catch (e) {
    console.error("[ai-configs/:id/pillars][POST] generation failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "柱の生成に失敗しました" },
      { status: 502 },
    );
  }

  const { error: updateErr } = await supabase
    .from("ai_configs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ content_pillars: pillars } as any)
    .eq("id", id)
    .eq("user_id", user.id);
  if (updateErr) {
    console.error(
      "[ai-configs/:id/pillars][POST] db update failed",
      updateErr,
    );
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ pillars });
}

/**
 * PUT — replace the whole pillar array with the caller's edited
 * version. Used by the UI when the user adds / removes / edits
 * individual pillars. Validates shape + assigns stable ids for any
 * pillar missing one (e.g. a brand-new pillar the user just typed).
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    pillars?: unknown;
  };
  if (!Array.isArray(body.pillars)) {
    return NextResponse.json(
      { error: "pillars (array) が必要です" },
      { status: 400 },
    );
  }

  const sanitized: ContentPillar[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < body.pillars.length; i++) {
    const p = body.pillars[i];
    if (!p || typeof p !== "object") continue;
    const rec = p as { id?: unknown; name?: unknown; description?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const description =
      typeof rec.description === "string" ? rec.description.trim() : "";
    if (!name) continue;
    const givenId = typeof rec.id === "string" ? rec.id.trim() : "";
    let pillarId = givenId || slugifyPillarName(name, i);
    // De-dupe id by suffixing -2, -3, ... if needed so anti-recency
    // tracking still works after a rename.
    let suffix = 1;
    while (seen.has(pillarId)) {
      suffix += 1;
      pillarId = `${givenId || slugifyPillarName(name, i)}-${suffix}`;
    }
    seen.add(pillarId);
    sanitized.push({ id: pillarId, name, description });
  }

  const { error: updateErr } = await supabase
    .from("ai_configs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ content_pillars: sanitized } as any)
    .eq("id", id)
    .eq("user_id", user.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ pillars: sanitized });
}
