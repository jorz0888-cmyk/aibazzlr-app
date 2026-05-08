import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHearingSession } from "@/lib/db/ai-hearing-sessions";
import { PromptPreview } from "@/components/hearing/PromptPreview";

export const dynamic = "force-dynamic";

export default async function HearingPreviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const session = await getHearingSession(supabase, sessionId);
  if (!session || session.user_id !== user.id) notFound();

  if (!session.extracted_data || !session.finalized_prompt) {
    redirect(`/dashboard/settings/ai/new/hearing/${sessionId}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── HEARING COMPLETE
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          AIがあなたのお店を理解しました
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          ヒアリング内容をもとにシステムプロンプトを生成しました。内容を確認・編集して保存してください。
          保存後はSNS投稿生成に利用できます。
        </p>
      </div>

      <PromptPreview
        sessionId={session.id}
        initialData={session.extracted_data}
        initialPrompt={session.finalized_prompt}
      />
    </div>
  );
}
