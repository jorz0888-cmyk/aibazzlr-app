import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { ManualForm } from "@/components/hearing/ManualForm";

export const dynamic = "force-dynamic";

export default async function ConfigEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) notFound();

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── EDIT
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          AI設定を編集
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          内容を変更すると、生成される投稿の方向性が変わります。
        </p>
      </div>

      <ManualForm mode="edit" initial={config} />
    </div>
  );
}
