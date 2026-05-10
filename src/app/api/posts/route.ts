import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDbError } from "@/lib/db/error";
import type { Post, PostStatus } from "@/lib/supabase/types";

export const runtime = "nodejs";

const VALID_STATUSES: PostStatus[] = [
  "pending",
  "draft",
  "queued",
  "scheduled",
  "publishing",
  "posted",
  "published",
  "failed",
  "cancelled",
];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const aiConfigId = url.searchParams.get("ai_config_id");
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? 20) || 20,
    100,
  );
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;

  let q = supabase
    .from("posts")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && (VALID_STATUSES as string[]).includes(status)) {
    q = q.eq("status", status as PostStatus);
  }
  if (aiConfigId) {
    q = q.eq("ai_config_id", aiConfigId);
  }

  const { data, error, count } = await q;
  if (error) {
    const info = extractDbError(error);
    return NextResponse.json(
      { error: `投稿一覧の取得に失敗: ${info.message}`, debug: info },
      { status: 500 },
    );
  }

  // Hydrate with ai_configs.name and social_accounts.username for the UI.
  const posts = (data ?? []) as Post[];
  const aiConfigIds = Array.from(
    new Set(posts.map((p) => p.ai_config_id).filter(Boolean) as string[]),
  );
  const accountIds = Array.from(
    new Set(
      posts.map((p) => p.social_account_id).filter(Boolean) as string[],
    ),
  );

  const [{ data: configs }, { data: accounts }] = await Promise.all([
    aiConfigIds.length
      ? supabase
          .from("ai_configs")
          .select("id, name, account_mode")
          .in("id", aiConfigIds)
      : Promise.resolve({ data: [] as { id: string; name: string; account_mode: string }[] }),
    accountIds.length
      ? supabase
          .from("social_accounts")
          .select("id, username, display_name, platform")
          .in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null; platform: string }[] }),
  ]);

  const configMap = new Map(
    (configs ?? []).map((c) => [c.id, c]),
  );
  const accountMap = new Map(
    (accounts ?? []).map((a) => [a.id, a]),
  );

  const enriched = posts.map((p) => ({
    ...p,
    ai_config: p.ai_config_id ? configMap.get(p.ai_config_id) ?? null : null,
    social_account: p.social_account_id
      ? accountMap.get(p.social_account_id) ?? null
      : null,
  }));

  return NextResponse.json({
    posts: enriched,
    total: count ?? enriched.length,
    has_more: (count ?? 0) > offset + enriched.length,
  });
}
