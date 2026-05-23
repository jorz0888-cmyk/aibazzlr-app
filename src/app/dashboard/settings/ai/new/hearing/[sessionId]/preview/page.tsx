import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getHearingSession,
  updateHearingSession,
} from "@/lib/db/ai-hearing-sessions";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { ensureAiConfigFromHearing } from "@/lib/db/ai-config-from-hearing";
import { normalizeAccountMode } from "@/lib/supabase/types";
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

  // 2026-05-23 T1 BUGFIX safety net: if the session reached the
  // preview page with extracted data but no linked ai_config (either
  // because it predates the auto-draft fix, or because the inline
  // /message path's draft-create attempt failed transiently), backfill
  // the draft inline on render. This guarantees that arriving at the
  // preview page always means the draft exists in AI設定一覧 —
  // matching the T1 user-facing contract.
  let draft = session.ai_config_id
    ? await getAiConfigById(supabase, session.ai_config_id)
    : null;
  if (!draft) {
    const backfilled = await ensureAiConfigFromHearing({
      client: supabase,
      userId: user.id,
      sessionId,
      existingAiConfigId: null,
      extracted: session.extracted_data,
      prompt: session.generated_system_prompt,
      sessionMode: normalizeAccountMode(session.account_mode),
      industry: session.industry,
    });
    if (backfilled.aiConfigId) {
      // Re-read so we can pass an accurate status downstream. The
      // freshly-inserted row has status='draft' by construction, but
      // a read keeps us honest if the helper changes.
      draft = await getAiConfigById(supabase, backfilled.aiConfigId);
      // Also link the session row in our in-memory copy so the rest
      // of the page renders consistently. (ensureAiConfigFromHearing
      // already wrote ai_config_id to the DB.)
      if (draft && !session.ai_config_id) {
        await updateHearingSession(supabase, sessionId, {
          ai_config_id: draft.id,
        }).catch(() => {
          /* already linked by helper — best-effort */
        });
      }
    }
  }
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
