import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHearingSession } from "@/lib/db/ai-hearing-sessions";
import { getAiConfigById } from "@/lib/db/ai-configs";
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

  if (!session.extracted_data || !session.generated_system_prompt) {
    redirect(`/dashboard/settings/ai/new/hearing/${sessionId}`);
  }

  // 2026-05-23 T1: read the auto-saved draft so the preview can
  // show the right activation state + a stable "後で有効化" link.
  // If the session predates the auto-draft fix and has no
  // ai_config_id yet, the next finalize call (triggered when the
  // preview client calls the endpoint, or proactively below) will
  // backfill it — for the first render we just show "未保存" UX.
  const draft = session.ai_config_id
    ? await getAiConfigById(supabase, session.ai_config_id)
    : null;
  const draftStatus: "draft" | "active" | null =
    draft?.status === "active"
      ? "active"
      : draft
        ? "draft"
        : null;

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
          ヒアリング内容をもとに AI設定を生成し、下書きとして自動保存しました。
          内容を確認・編集して「この設定を有効化する」を押すと、投稿生成に使えるようになります。
        </p>
      </div>

      <PromptPreview
        sessionId={session.id}
        initialData={session.extracted_data}
        initialPrompt={session.generated_system_prompt}
        draftStatus={draftStatus}
        draftConfigId={draft?.id ?? null}
      />
    </div>
  );
}
