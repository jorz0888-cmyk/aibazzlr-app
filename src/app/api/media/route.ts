import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const aiConfigId = request.nextUrl.searchParams.get("ai_config_id");
  let query = supabase
    .from("media_library")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (aiConfigId) query = query.eq("ai_config_id", aiConfigId);

  const { data, error } = await query;
  if (error) {
    console.error("[media][GET] list failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ media: data ?? [] });
}
