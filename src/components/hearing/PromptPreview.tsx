"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { TestPostGenerator } from "./TestPostGenerator";
import { toStringArray } from "@/lib/ai/normalize-extracted";
import type { ExtractedHearingData } from "@/lib/supabase/types";

type Props = {
  sessionId: string;
  initialData: ExtractedHearingData;
  initialPrompt: string;
  /** 2026-05-23 T1: the auto-saved draft's status, "draft" | "active". */
  draftStatus: "draft" | "active" | null;
  /** 2026-05-23 T1: id of the auto-saved draft, used by "後で有効化" link. */
  draftConfigId: string | null;
};

export function PromptPreview({
  sessionId,
  initialData,
  initialPrompt,
  draftStatus,
  draftConfigId,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialData.business_name ?? "");
  const [worldView, setWorldView] = useState(initialData.world_view ?? "");
  const [voiceTone, setVoiceTone] = useState(initialData.voice_tone ?? "");
  const [target, setTarget] = useState(initialData.target_audience ?? "");
  const [must, setMust] = useState(
    (initialData.must_include_elements ?? []).join("\n"),
  );
  const [ng, setNg] = useState((initialData.ng_words ?? []).join("\n"));
  const [examples, setExamples] = useState(
    (initialData.good_examples ?? []).join("\n\n---\n\n"),
  );
  const [hashtags, setHashtags] = useState(
    (initialData.hashtag_pool ?? []).join(" "),
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDebug, setErrorDebug] = useState<{
    code?: string | null;
    message?: string | null;
    hint?: string | null;
    details?: string | null;
  } | null>(null);

  function splitLines(s: string) {
    return s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  function splitExamples(s: string) {
    return s
      .split(/\n*---\n*/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function save() {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-hearing/${sessionId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          is_default: isDefault,
          prompt_overrides: {
            business_name: name,
            world_view: worldView,
            voice_tone: voiceTone,
            target_audience: target,
            must_include_elements: splitLines(must),
            ng_words: splitLines(ng),
            good_examples: splitExamples(examples),
            hashtag_pool: hashtags
              .split(/\s+/)
              .map((t) => t.trim())
              .filter(Boolean),
            generated_system_prompt: prompt,
          },
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          debug_save?: typeof errorDebug;
        };
        if (err.debug_save) setErrorDebug(err.debug_save);
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { aiConfigId } = (await res.json()) as { aiConfigId: string };
      router.push(`/dashboard/settings/ai/${aiConfigId}`);
      router.refresh();
    } catch (e) {
      setError(safeErrorMessage(e, "保存に失敗しました"));
      setSaving(false);
    }
  }

  const mode = initialData.account_mode === "fictional" ? "fictional" : "real";

  // 2026-05-23 T1: while the config is still a draft, warn on tab
  // close / navigation away. The auto-save protects against losing
  // the AI's structured output (we wrote it as a draft on finalize),
  // but any hand-edits on this page or the unactivated state itself
  // would otherwise leave silently.
  useEffect(() => {
    if (draftStatus !== "draft") return;
    function handler(e: BeforeUnloadEvent) {
      // Browsers ignore the message text — setting returnValue is
      // what actually triggers the prompt on modern browsers.
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draftStatus]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {mode === "real" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 font-mono text-[11px] tracking-widest text-cyan">
            🏪 実在モード（捏造禁止）
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] tracking-widest text-accent">
            🎭 架空モード（v14スタイル）
          </span>
        )}
        {draftStatus === "draft" && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 font-mono text-[11px] tracking-widest text-warning"
            title="この設定はすでに『下書き』として保存されています。投稿生成に使うには有効化してください。"
          >
            📝 下書き保存済み — 未有効化
          </span>
        )}
        {draftStatus === "active" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 font-mono text-[11px] tracking-widest text-success">
            ✓ 有効化済み
          </span>
        )}
      </div>

      {draftStatus === "draft" && (
        <div className="card border-warning/30 bg-warning/5 p-4 text-xs leading-relaxed text-ink">
          <p className="font-bold text-warning">
            この設定は『下書き』として自動保存されています
          </p>
          <p className="mt-1 text-ink-muted">
            ここで「この設定を有効化する」を押すと、投稿生成に使えるようになります。
            ページを離れても下書きは AI設定一覧に残るので、後から続きを編集して有効化できます。
          </p>
        </div>
      )}

      {initialData.summary_message && (
        <div className="card border-cyan/30 bg-cyan/5 p-5 text-sm leading-relaxed text-ink">
          💬 {initialData.summary_message}
        </div>
      )}

      {mode === "real" && (
        <Section title="🏪 実在情報">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyField
              label="営業時間"
              value={initialData.business_hours}
            />
            <ReadOnlyField
              label="定休日"
              value={initialData.closed_days}
            />
            <ReadOnlyField label="所在地" value={initialData.address} />
            <ReadOnlyField
              label="価格帯"
              value={initialData.price_range}
            />
          </div>
          <ReadOnlyList label="看板メニュー" items={initialData.menu_items} />
          <ReadOnlyList
            label="季節限定・日替わり"
            items={initialData.seasonal_items}
          />
          <ReadOnlyList
            label="実話エピソード"
            items={initialData.real_episodes}
          />
          <ReadOnlyList
            label="告知テーマ"
            items={initialData.announcement_topics}
          />
          <p className="pt-2 text-[11px] text-ink-subtle">
            実在情報は現状読み取り専用です。編集が必要な場合は「もう一度ヒアリング」してください。
          </p>
        </Section>
      )}

      <Section title="基本情報">
        <Field label="設定の名前" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            maxLength={30}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="声のトーン">
            <select
              value={voiceTone}
              onChange={(e) => setVoiceTone(e.target.value)}
              className="input"
            >
              <option value="">指定なし</option>
              <option value="casual_polite">カジュアル丁寧</option>
              <option value="friendly_polite">フレンドリー丁寧</option>
              <option value="energetic_polite">エネルギッシュ丁寧</option>
              <option value="professional_polite">プロフェッショナル</option>
              <option value="calm_polite">落ち着き丁寧</option>
            </select>
          </Field>
          <Field label="ターゲット読者">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input"
              maxLength={30}
            />
          </Field>
        </div>
      </Section>

      <Section title="世界観">
        <Field label="世界観・空気感">
          <textarea
            value={worldView}
            onChange={(e) => setWorldView(e.target.value)}
            className="input min-h-[140px]"
            rows={6}
          />
        </Field>
      </Section>

      <Section title="必須要素・NGワード">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="必須要素（1行1個）">
            <textarea
              value={must}
              onChange={(e) => setMust(e.target.value)}
              className="input min-h-[120px] font-mono text-[13px]"
            />
          </Field>
          <Field label="NGワード（1行1個）">
            <textarea
              value={ng}
              onChange={(e) => setNg(e.target.value)}
              className="input min-h-[120px] font-mono text-[13px]"
            />
          </Field>
        </div>
      </Section>

      <Section title="良い投稿例">
        <Field label="良い投稿例（--- で区切る）">
          <textarea
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            className="input min-h-[180px]"
          />
        </Field>
      </Section>

      <Section title="ハッシュタグ">
        <Field label="ハッシュタグプール（スペース区切り）">
          <input
            type="text"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            className="input font-mono text-[13px]"
            placeholder="#朝活 #カフェ巡り #...."
          />
        </Field>
      </Section>

      <Section
        title="生成されたシステムプロンプト"
        action={
          <button
            type="button"
            onClick={() => setEditingPrompt((v) => !v)}
            className="btn-ghost"
          >
            {editingPrompt ? "閉じる" : "編集する"}
          </button>
        }
      >
        {editingPrompt ? (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="input min-h-[360px] font-mono text-[12px] leading-relaxed"
          />
        ) : (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg/60 p-4 font-mono text-[12px] leading-relaxed text-ink-muted">
            {prompt}
          </pre>
        )}
      </Section>

      <TestPostGenerator
        sessionId={sessionId}
        brandName={name || "あなたのブランド"}
      />

      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4 accent-cyan"
          />
          デフォルトのAI設定にする
        </label>

        {error && (
          <div className="err w-full space-y-1 sm:max-w-md">
            <div>{error}</div>
            {errorDebug && (
              <details className="text-[11px] text-danger/70">
                <summary className="cursor-pointer">技術的な詳細</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all font-mono">
                  {errorDebug.code ? `[${errorDebug.code}] ` : ""}
                  {errorDebug.message ?? ""}
                  {errorDebug.hint ? `\nヒント: ${errorDebug.hint}` : ""}
                  {errorDebug.details ? `\n詳細: ${errorDebug.details}` : ""}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/dashboard/settings/ai")}
            className="btn-secondary"
            disabled={saving}
            title="下書きは自動保存済み。AI設定一覧から続きを編集できます。"
          >
            {draftConfigId ? "後で有効化する" : "キャンセル"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="btn-primary"
          >
            {saving ? (
              <Spinner />
            ) : draftStatus === "active" ? (
              "更新して保存する →"
            ) : (
              "この設定を有効化する →"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          {title}
        </h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Defensively extract a string from arbitrary thrown values so we never show
 * "[object Object]" in the UI.
 */
function safeErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    if (m && typeof m === "object") {
      const inner = (m as { message?: unknown }).message;
      if (typeof inner === "string" && inner) return inner;
    }
    try {
      return JSON.stringify(e);
    } catch {
      /* noop */
    }
  }
  return fallback;
}

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm text-ink">
        {value || <span className="text-ink-subtle">—</span>}
      </div>
    </div>
  );
}

function ReadOnlyList({
  label,
  items,
}: {
  label: string;
  items: unknown;
}) {
  // Defensive: items might still contain object entries if Claude emitted
  // {name, price} shapes. Always coerce through toStringArray.
  const list = toStringArray(items);
  return (
    <div>
      <div className="label">
        {label} <span className="text-ink-subtle">({list.length})</span>
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm text-ink-subtle">
          未登録
        </div>
      ) : (
        <ul className="space-y-1">
          {list.map((it, i) => (
            <li
              key={i}
              className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm text-ink"
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
