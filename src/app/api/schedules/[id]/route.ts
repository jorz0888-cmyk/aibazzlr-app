import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
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

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const patch: {
    hour?: number;
    minute?: number;
    weekdays?: number[];
    enabled?: boolean;
  } = {};
  if (body.hour !== undefined) {
    if (!validHour(body.hour)) {
      return NextResponse.json({ error: "invalid hour" }, { status: 400 });
    }
    patch.hour = body.hour;
  }
  if (body.minute !== undefined) {
    if (!validMinute(body.minute)) {
      return NextResponse.json({ error: "invalid minute" }, { status: 400 });
    }
    patch.minute = body.minute;
  }
  if (body.weekdays !== undefined) {
    if (
      !Array.isArray(body.weekdays) ||
      body.weekdays.length === 0 ||
      body.weekdays.some(
        (d) => typeof d !== "number" || d < 0 || d > 6 || !Number.isInteger(d),
      )
    ) {
      return NextResponse.json({ error: "invalid weekdays" }, { status: 400 });
    }
    patch.weekdays = body.weekdays;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "invalid enabled" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "nothing to update" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("schedules")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) {
    console.error("[schedules/:id][PATCH] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ schedule: data });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error("[schedules/:id][DELETE] failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
