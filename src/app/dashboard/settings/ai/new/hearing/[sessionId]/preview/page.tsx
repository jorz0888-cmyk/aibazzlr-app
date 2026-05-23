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

  // 2026-05-23 safety net: if the session reached the preview page
  // with extracted data but no linked ai_config, backfill the draft
  // inline on render. Now that we surface helper failure (see
  // ensureAiConfigFromHearing), the page heading reflects the actual
  // save state instead of a static "saved" lie.
  let draft = session.ai_config_id
    ? await getAiConfigById(supabase, session.ai_config_id)
    : null;
  let saveError: { code: string | null; message: string } | null = null;
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
      draft = await getAiConfigById(supabase, backfilled.aiConfigId);
      if (draft && !session.ai_config_id) {
        await updateHearingSession(supabase, sessionId, {
          ai_config_id: draft.id,
        }).catch(() => {
          /* already linked by helper — best-effort */
        });
      }
    } else if (backfilled.error) {
      saveError = backfilled.error;
    }
  }
  const draftStatus: "draft" | "active" | null =
    draft?.status === "active"
      ? "active"
      : draft
        ? "draft"
        : null;

  // 2026-05-23 copy fix: business-mode-neutral heading. The previous
  // copy ("AIがあなたのお店を理解しました") only made sense for
  // real-mode 店舗 users; fictional / personal-brand / kyara accounts
  // also use this flow and were left with awkward wording.
  const sessionMode = normalizeAccountMode(session.account_mode);
  const headingText =
    sessionMode === "fictional"
      ? "AIがあなたの発信スタイルを理解しました"
      : "AIがあなたの発信スタイルを理解しました";
  // 2026-05-23 honesty fix: lead text only claims auto-save when it
  // actually succeeded. On failure we surface the DB error verbatim
  // + the support address — no green-light text over a broken save.
  const leadText =
    draftStatus !== null
      ? "ヒアリング内容をもとに AI設定を生成し、下書きとして自動保存しました。内容を確認・編集して「この設定を有効化する」を押すと、投稿生成に使えるようになります。"
      : "ヒアリング内容をもとに AI設定を生成しました。下書きの自動保存ができなかったため、有効化を押すか、内容を確認してください。";

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── HEARING COMPLETE
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          {headingText}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          {leadText}
        </p>
        {saveError && (
          <div className="mt-3 max-w-2xl rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            下書きの自動保存に失敗しました
            {saveError.code ? `（コード: ${saveError.code}）` : ""}：
            {saveError.message}
            <br />
            お手数ですが、画面下の「この設定を有効化する」を押して直接有効化するか、
            <a
              href="mailto:support@aibazzlr.com"
              className="underline-offset-2 hover:underline"
            >
              support@aibazzlr.com
            </a>
            までご連絡ください。
          </div>
        )}
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
