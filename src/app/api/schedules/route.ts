import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CreateBody = {
  ai_config_id?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  enabled?: boolean;
};

function validHour(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 23;
}
function validMinute(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 59;
}
function validWeekdays(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every(
      (d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6,
    ) &&
    v.length > 0
  );
}

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
    .from("schedules")
    .select("*")
    .eq("user_id", user.id)
    .order("hour", { ascending: true })
    .order("minute", { ascending: true });

  if (aiConfigId) query = query.eq("ai_config_id", aiConfigId);

  const { data, error } = await query;
  if (error) {
    console.error("[schedules][GET] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const { ai_config_id, hour, minute = 0, weekdays, enabled = true } = body;

  if (!ai_config_id || typeof ai_config_id !== "string") {
    return NextResponse.json(
      { error: "ai_config_id is required" },
      { status: 400 },
    );
  }
  if (!validHour(hour)) {
    return NextResponse.json(
      { error: "hour must be an integer 0-23" },
      { status: 400 },
    );
  }
  if (!validMinute(minute)) {
    return NextResponse.json(
      { error: "minute must be an integer 0-59" },
      { status: 400 },
    );
  }
  const wd = weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  if (!validWeekdays(wd)) {
    return NextResponse.json(
      { error: "weekdays must be a non-empty array of integers 0-6" },
      { status: 400 },
    );
  }

  // Confirm ownership of the ai_config.
  const { data: cfg } = await supabase
    .from("ai_configs")
    .select("id, user_id")
    .eq("id", ai_config_id)
    .single();
  if (!cfg || cfg.user_id !== user.id) {
    return NextResponse.json(
      { error: "AI config not found" },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from("schedules")
    .insert({
      ai_config_id,
      user_id: user.id,
      hour,
      minute,
      weekdays: wd,
      enabled,
    })
    .select("*")
    .single();

  if (error) {
    // 23505 = unique violation (same hour:minute already exists for this config).
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "同じ時刻のスケジュールが既に存在します" },
        { status: 409 },
      );
    }
    console.error("[schedules][POST] insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ schedule: data }, { status: 201 });
}
