import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeImageWithVision, mergeTags } from "@/lib/media/vision";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Phase 12.1: run Vision over the caller's media_library rows that don't
 * yet have an ai_description, merging the new tags into whatever the user
 * already typed. Capped at 50 rows per call so we stay inside Vercel's
 * function timeout; the UI can call it again to pick up the next batch.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("media_library")
    .select("id, public_url, tags, ai_description")
    .eq("user_id", user.id)
    .is("ai_description", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[media/backfill-tags] list failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = rows ?? [];
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    remaining_after_batch: 0,
  };

  for (const item of items) {
    results.processed++;
    try {
      const vision = await analyzeImageWithVision(item.public_url);
      if (!vision) {
        results.failed++;
        continue;
      }
      const merged = mergeTags(item.tags ?? [], vision.tags);
      const { error: upErr } = await supabase
        .from("media_library")
        .update({
          tags: merged,
          ai_description: vision.description,
        })
        .eq("id", item.id)
        .eq("user_id", user.id);
      if (upErr) {
        console.warn("[media/backfill-tags] update failed", upErr);
        results.failed++;
      } else {
        results.succeeded++;
      }
    } catch (e) {
      console.warn("[media/backfill-tags] vision failed", e);
      results.failed++;
    }
    // Light pacing so we don't get throttled by Gemini on big libraries.
    await new Promise((r) => setTimeout(r, 200));
  }

  // Tell the UI whether another batch is needed.
  const { count } = await supabase
    .from("media_library")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("ai_description", null);
  results.remaining_after_batch = count ?? 0;

  return NextResponse.json(results);
}
