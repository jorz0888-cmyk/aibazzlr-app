import Link from "next/link";
import type { AiHearingSession } from "@/lib/supabase/types";

/**
 * 2026-05-23 T2: surface ALL of the user's hearing sessions so a
 * session that got interrupted (or whose draft hasn't been activated)
 * can be picked back up. The spec is explicit: "未完了／完了済みの
 * ヒアリングセッションを表示する". Earlier iteration filtered out
 * sessions whose linked config was already active — that was wrong:
 * the spec listed all of them, and hiding everything when nothing
 * matched the filter resulted in the section never showing at all
 * for the most common user state (Free user with one active config).
 *
 * Per-row state:
 *   - in_progress         → resume the chat where they left off.
 *   - completed + linked draft → activate from preview.
 *   - completed + linked active → view the config detail (already in
 *     the 自分の設定 list above, but link kept here as a "from
 *     hearing X" trail so the user can confirm what they ran).
 *   - completed without a linked config → preview (will backfill the
 *     draft on render, see preview/page.tsx).
 *   - abandoned           → muted, but resumable.
 */

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  in_progress: {
    label: "進行中",
    tone: "border-cyan/40 bg-cyan/10 text-cyan",
  },
  completed: {
    label: "完了",
    tone: "border-success/40 bg-success/10 text-success",
  },
  abandoned: {
    label: "中断",
    tone: "border-line-strong bg-white/5 text-ink-subtle",
  },
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

export type SessionRow = AiHearingSession & {
  /** When the session has been linked to an ai_config, its status. */
  linkedConfigStatus?: "draft" | "active" | string | null;
  /** The linked config's display name, for the "from hearing X" trail. */
  linkedConfigName?: string | null;
};

export function HearingSessionsSection({
  sessions,
}: {
  sessions: SessionRow[];
}) {
  // 2026-05-23 BUGFIX: ALWAYS render when the user has at least one
  // session, regardless of how each session breaks down. Earlier the
  // section returned `null` when no session matched the filter,
  // which made the entire feature invisible for the most common
  // production case (1 hearing → 1 active config). The spec is to
  // list every session.
  if (sessions.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          ヒアリング履歴
        </h2>
        <p className="mt-1 text-xs text-ink-subtle">
          中断したヒアリングや、まだ有効化していない設定はここから再開できます。
        </p>
      </div>

      <ul className="grid gap-2">
        {sessions.map((s) => {
          const isCompleted = s.status === "completed";
          const isAbandoned = s.status === "abandoned";
          const linkedDraft = s.linkedConfigStatus === "draft";
          const linkedActive = s.linkedConfigStatus === "active";

          const meta = STATUS_LABELS[s.status] ?? {
            label: s.status,
            tone: "border-line-strong bg-white/5 text-ink-subtle",
          };

          // Resume target — for completed sessions go to preview
          // (preview server component backfills the draft on render
          // if it's missing, so this is always a valid landing).
          // Already-active linked configs jump straight to the
          // config detail page since the activation step is done.
          const href = linkedActive
            ? `/dashboard/settings/ai/${s.ai_config_id}`
            : isCompleted
              ? `/dashboard/settings/ai/new/hearing/${s.id}/preview`
              : `/dashboard/settings/ai/new/hearing/${s.id}`;

          const cta = linkedActive
            ? "AI設定を開く →"
            : linkedDraft
              ? "下書きを有効化する →"
              : isCompleted
                ? "プレビューを開く →"
                : isAbandoned
                  ? "再開する →"
                  : "続きから →";

          return (
            <li
              key={s.id}
              className={[
                "card p-4 transition hover:border-cyan/30",
                isAbandoned ? "opacity-70" : "",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                    {linkedDraft && (
                      <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-warning">
                        下書き保存済み — 未有効化
                      </span>
                    )}
                    {linkedActive && (
                      <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-cyan">
                        ✓ 有効化済み
                      </span>
                    )}
                    {s.account_mode && (
                      <span className="font-mono text-[10px] text-ink-subtle">
                        {s.account_mode === "fictional"
                          ? "🎭 架空"
                          : "🏪 実在"}
                      </span>
                    )}
                    {s.industry && (
                      <span className="font-mono text-[10px] text-ink-subtle">
                        {s.industry}
                      </span>
                    )}
                  </div>
                  {s.linkedConfigName && (
                    <div className="mt-1 truncate text-sm font-bold text-ink">
                      {s.linkedConfigName}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-ink-muted">
                    最終更新: {formatRelative(s.updated_at ?? s.created_at)}
                    {typeof s.current_step === "number" &&
                      s.current_step > 0 && (
                        <span className="ml-2">進捗 step {s.current_step}</span>
                      )}
                  </div>
                </div>
                <Link href={href} className="btn-secondary text-xs">
                  {cta}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
