"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import type { Schedule, PostingMode } from "@/lib/supabase/types";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAYS_ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS_WEEKDAYS = [1, 2, 3, 4, 5];

import { friendlyErrorMessage } from "@/lib/errors/client";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(friendlyErrorMessage(data));
  return data;
}

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTime(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(s.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function weekdayPreset(weekdays: number[]): string {
  if (weekdays.length === 7) return "毎日";
  if (
    weekdays.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))
  ) {
    return "平日のみ";
  }
  if (
    weekdays.length === 2 &&
    [0, 6].every((d) => weekdays.includes(d))
  ) {
    return "週末のみ";
  }
  return weekdays
    .slice()
    .sort()
    .map((d) => WEEKDAY_LABELS[d])
    .join("・");
}

/**
 * Format the next firing time for a single schedule entry, in JST. Returns a
 * short relative-time string ("今日 19:00" / "明日 07:00" / "5月20日 (火) 07:00").
 */
function nextFireText(h: number, m: number, weekdays: number[]): string {
  if (weekdays.length === 0) return "—";
  const nowUtc = new Date();
  // Convert "now" to JST (UTC+9).
  const jstMs = nowUtc.getTime() + 9 * 60 * 60 * 1000;
  for (let i = 0; i < 8; i++) {
    const probe = new Date(jstMs + i * 24 * 60 * 60 * 1000);
    const wd = probe.getUTCDay();
    if (!weekdays.includes(wd)) continue;
    const candidate = new Date(
      Date.UTC(
        probe.getUTCFullYear(),
        probe.getUTCMonth(),
        probe.getUTCDate(),
        h,
        m,
        0,
      ),
    );
    // Convert candidate (treated as JST clock) back to a UTC instant.
    const candidateUtcMs = candidate.getTime() - 9 * 60 * 60 * 1000;
    if (i === 0 && candidateUtcMs <= nowUtc.getTime()) continue;
    const days = i;
    const tag =
      days === 0 ? "今日" : days === 1 ? "明日" : `${probe.getUTCMonth() + 1}/${probe.getUTCDate()}(${WEEKDAY_LABELS[wd]})`;
    return `${tag} ${fmtTime(h, m)}`;
  }
  return "—";
}

export function AutoPostSection({
  aiConfigId,
  initialPostingMode,
  initialAutoPostEnabled,
}: {
  aiConfigId: string;
  initialPostingMode: PostingMode;
  initialAutoPostEnabled: boolean;
}) {
  const router = useRouter();
  const [postingMode, setPostingMode] = useState<PostingMode>(
    initialPostingMode,
  );
  const [autoPostEnabled, setAutoPostEnabled] = useState(
    initialAutoPostEnabled,
  );
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // New-schedule input state
  const [newTime, setNewTime] = useState("07:00");
  const [newWeekdays, setNewWeekdays] =
    useState<number[]>(WEEKDAYS_ALL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await jsonFetch<{ schedules: Schedule[] }>(
          `/api/schedules?ai_config_id=${aiConfigId}`,
        );
        if (!cancelled) setSchedules(data.schedules);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "読み込み失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiConfigId]);

  async function savePostingSettings(next: {
    mode?: PostingMode;
    enabled?: boolean;
  }) {
    setErr(null);
    const body: Record<string, unknown> = {};
    if (next.mode !== undefined) body.posting_mode = next.mode;
    if (next.enabled !== undefined) body.auto_post_enabled = next.enabled;
    try {
      await jsonFetch(`/api/ai-configs/${aiConfigId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失敗");
      // Roll back optimistic state
      if (next.mode !== undefined) setPostingMode(initialPostingMode);
      if (next.enabled !== undefined)
        setAutoPostEnabled(initialAutoPostEnabled);
    }
  }

  async function addSchedule() {
    setErr(null);
    const t = parseTime(newTime);
    if (!t) {
      setErr("時刻は HH:MM 形式で指定してください (例: 07:00)");
      return;
    }
    if (newWeekdays.length === 0) {
      setErr("少なくとも1つの曜日を選んでください");
      return;
    }
    setLoading(true);
    try {
      const data = await jsonFetch<{ schedule: Schedule }>("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_config_id: aiConfigId,
          hour: t.h,
          minute: t.m,
          weekdays: newWeekdays,
          enabled: true,
        }),
      });
      setSchedules((prev) => [...(prev ?? []), data.schedule]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "追加失敗");
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled(s: Schedule) {
    setErr(null);
    const next = !s.enabled;
    setSchedules(
      (prev) =>
        prev?.map((x) => (x.id === s.id ? { ...x, enabled: next } : x)) ??
        null,
    );
    try {
      await jsonFetch(`/api/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新失敗");
      setSchedules(
        (prev) =>
          prev?.map((x) => (x.id === s.id ? { ...x, enabled: !next } : x)) ??
          null,
      );
    }
  }

  async function deleteSchedule(s: Schedule) {
    setErr(null);
    if (!confirm(`${fmtTime(s.hour, s.minute)} のスケジュールを削除しますか？`))
      return;
    setSchedules((prev) => prev?.filter((x) => x.id !== s.id) ?? null);
    try {
      await jsonFetch(`/api/schedules/${s.id}`, { method: "DELETE" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除失敗");
      // Reload from server on failure
      try {
        const data = await jsonFetch<{ schedules: Schedule[] }>(
          `/api/schedules?ai_config_id=${aiConfigId}`,
        );
        setSchedules(data.schedules);
      } catch {
        /* noop */
      }
    }
  }

  return (
    <section className="card space-y-5 p-5 transition hover:border-cyan/20">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          自動投稿設定
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoPostEnabled}
            onChange={(e) => {
              const next = e.target.checked;
              setAutoPostEnabled(next);
              void savePostingSettings({ enabled: next });
            }}
          />
          <span
            className={
              autoPostEnabled ? "font-bold text-cyan" : "text-ink-muted"
            }
          >
            {autoPostEnabled ? "有効" : "無効"}
          </span>
        </label>
      </header>

      <div className="space-y-3">
        <p className="label !mb-1">投稿モード</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ModeRadio
            label="完全自動"
            description="AI が生成 → 即 X に投稿"
            value="auto"
            current={postingMode}
            onChange={(v) => {
              setPostingMode(v);
              void savePostingSettings({ mode: v });
            }}
          />
          <ModeRadio
            label="承認制"
            description="生成 → ダッシュボードで承認 → API で投稿"
            value="approval"
            current={postingMode}
            onChange={(v) => {
              setPostingMode(v);
              void savePostingSettings({ mode: v });
            }}
          />
          <ModeRadio
            label="コピペモード"
            description="生成 → 通知 → 自分で X に投稿（X API 不使用）"
            highlight="新規 X 推奨"
            value="manual"
            current={postingMode}
            onChange={(v) => {
              setPostingMode(v);
              void savePostingSettings({ mode: v });
            }}
          />
        </div>
        <p className="rounded-md border border-line bg-white/5 p-3 text-[11px] leading-relaxed text-ink-subtle">
          <b className="text-ink">X アカウントの状態について</b>
          <br />
          新規 X アカウント（作成から数週間以内）の場合、X 側のスパム対策により API
          投稿が <span className="text-warning">403 Forbidden</span> でブロックされることがあります。
          まずは <b>コピペモード</b> でアカウントを育て、軌道に乗ったら 承認制 / 完全自動 に切り替えるのがおすすめです。
        </p>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <p className="label !mb-0">スケジュール（JST）</p>
          {schedules && (
            <span className="font-mono text-[11px] text-ink-subtle">
              {schedules.length} 件
            </span>
          )}
        </div>

        {schedules === null ? (
          <div className="grid place-items-center py-6">
            <Spinner />
          </div>
        ) : schedules.length === 0 ? (
          <p className="text-xs text-ink-subtle">
            まだスケジュールが登録されていません。下の入力欄から追加してください。
          </p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white/5 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold text-ink">
                      {fmtTime(s.hour, s.minute)}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {weekdayPreset(s.weekdays)}
                    </span>
                    {!s.enabled && (
                      <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] tracking-wider text-ink-subtle">
                        OFF
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    次回: {nextFireText(s.hour, s.minute, s.weekdays)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => toggleEnabled(s)}
                  >
                    {s.enabled ? "OFF" : "ON"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => deleteSchedule(s)}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 rounded-lg border border-dashed border-line p-3 sm:grid-cols-[120px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="label !mb-1 block">時刻</span>
            <input
              type="time"
              className="input"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
            />
          </label>

          <div>
            <span className="label !mb-1 block">曜日</span>
            <div className="flex flex-wrap gap-2">
              <PresetButton
                label="毎日"
                active={newWeekdays.length === 7}
                onClick={() => setNewWeekdays(WEEKDAYS_ALL)}
              />
              <PresetButton
                label="平日"
                active={
                  newWeekdays.length === 5 &&
                  [1, 2, 3, 4, 5].every((d) => newWeekdays.includes(d))
                }
                onClick={() => setNewWeekdays(WEEKDAYS_WEEKDAYS)}
              />
              {WEEKDAY_LABELS.map((label, i) => {
                const active = newWeekdays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    className={[
                      "h-7 w-7 rounded-full border text-xs transition",
                      active
                        ? "border-cyan bg-cyan/15 text-cyan"
                        : "border-line text-ink-muted hover:border-cyan/40",
                    ].join(" ")}
                    onClick={() => {
                      setNewWeekdays((prev) =>
                        prev.includes(i)
                          ? prev.filter((d) => d !== i)
                          : [...prev, i].sort(),
                      );
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={addSchedule}
            disabled={loading}
          >
            {loading ? <Spinner /> : "+ 追加"}
          </button>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <p className="rounded-md bg-white/5 p-3 text-[11px] leading-relaxed text-ink-subtle">
        スケジュールは <b>日本標準時（JST）</b> で評価されます。自動投稿を有効化すると、
        指定時刻に AI が投稿を生成し、
        {postingMode === "auto"
          ? "そのまま X へ投稿します。"
          : postingMode === "approval"
            ? "ダッシュボード上で承認を求めます。承認時に X API 経由で投稿します。"
            : "ダッシュボードに「コピペ待ち」として表示します。本文をコピーして自分で X に投稿してください。"}
        月の投稿上限（Free 10 件 / Standard 150 件 / Premium 450 件）に達した場合は
        自動的にスキップされます。
      </p>
    </section>
  );
}

function ModeRadio({
  label,
  description,
  value,
  current,
  onChange,
  highlight,
}: {
  label: string;
  description: string;
  value: PostingMode;
  current: PostingMode;
  onChange: (v: PostingMode) => void;
  highlight?: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={[
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition",
        active
          ? "border-cyan bg-cyan/10 text-ink"
          : "border-line text-ink-muted hover:border-cyan/40",
      ].join(" ")}
    >
      <span className="flex w-full items-center justify-between gap-2 font-bold">
        <span className="flex items-center gap-2">
          <span
            className={[
              "grid h-4 w-4 place-items-center rounded-full border",
              active ? "border-cyan" : "border-line-strong",
            ].join(" ")}
          >
            {active && <span className="h-2 w-2 rounded-full bg-cyan" />}
          </span>
          {label}
        </span>
        {highlight && (
          <span className="rounded-full bg-cyan/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-cyan">
            {highlight}
          </span>
        )}
      </span>
      <span className="text-[11px] text-ink-subtle">{description}</span>
    </button>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-2.5 py-1 text-[11px] transition",
        active
          ? "border-cyan bg-cyan/15 text-cyan"
          : "border-line text-ink-muted hover:border-cyan/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
