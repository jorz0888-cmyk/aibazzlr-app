import Link from "next/link";
import type { AiHearingSession } from "@/lib/supabase/types";

/**
 * 2026-05-23 T2: surface in-progress + completed hearing sessions on
 * the AI settings page so a user who got pulled away can finish or
 * activate their previous session instead of being silently stuck.
 *
 * Display rules:
 *   - status="in_progress" (or anything pre-completed): link → chat
 *     page where they left off.
 *   - status="completed" but no ai_config_id linked yet: link →
 *     preview (auto-draft would have linked one in normal flow; this
 *     handles the pre-fix legacy sessions).
 *   - status="completed" WITH ai_config_id where the config is draft:
 *     link → preview so the user can activate it.
 *   - status="completed" WITH active ai_config: hidden (the active
 *     config is already visible in the main "自分の設定" list, so
 *     repeating the session here is just noise).
 *   - status="abandoned": shown muted, can be resumed but discouraged.
 */

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  in_progress: {
    label: "進行中",
    tone: "border-cyan/40 bg-cyan/10 text-cyan",
  },
  completed: {
    label: "完了 — 未有効化",
    tone: "border-warning/40 bg-warning/10 text-warning",
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
};

export function HearingSessionsSection({
  sessions,
}: {
  sessions: SessionRow[];
}) {
  // Filter out sessions whose active config is already in the main
  // list — those don't need a second entry point. Keep abandoned for
  // recovery scenarios but don't promote them visually.
  const visible = sessions.filter(
    (s) => s.linkedConfigStatus !== "active",
  );

  if (visible.length === 0) return null;

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
        {visible.map((s) => {
          const isInProgress =
            s.status !== "completed" && s.status !== "abandoned";
          const isCompletedDraft =
            s.status === "completed" && s.linkedConfigStatus === "draft";
          const isCompletedUnlinked =
            s.status === "completed" && !s.linkedConfigStatus;
          const isAbandoned = s.status === "abandoned";

          const meta = STATUS_LABELS[s.status] ?? {
            label: s.status,
            tone: "border-line-strong bg-white/5 text-ink-subtle",
          };

          // Resume target — completed → preview, otherwise → chat.
          const href =
            isCompletedDraft || isCompletedUnlinked
              ? `/dashboard/settings/ai/new/hearing/${s.id}/preview`
              : `/dashboard/settings/ai/new/hearing/${s.id}`;

          const cta = isCompletedDraft
            ? "下書きを有効化する →"
            : isCompletedUnlinked
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
                    {s.industry && (
                      <span className="font-mono text-[10px] text-ink-subtle">
                        {s.industry}
                      </span>
                    )}
                    {s.account_mode && (
                      <span className="font-mono text-[10px] text-ink-subtle">
                        {s.account_mode === "fictional"
                          ? "🎭 架空"
                          : "🏪 実在"}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
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
