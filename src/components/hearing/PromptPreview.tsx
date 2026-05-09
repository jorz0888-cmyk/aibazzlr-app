"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { TestPostGenerator } from "./TestPostGenerator";
import type { ExtractedHearingData } from "@/lib/supabase/types";

type Props = {
  sessionId: string;
  initialData: ExtractedHearingData;
  initialPrompt: string;
};

export function PromptPreview({
  sessionId,
  initialData,
  initialPrompt,
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
            finalized_prompt: prompt,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { aiConfigId } = (await res.json()) as { aiConfigId: string };
      router.push(`/dashboard/settings/ai/${aiConfigId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {initialData.summary_message && (
        <div className="card border-cyan/30 bg-cyan/5 p-5 text-sm leading-relaxed text-ink">
          💬 {initialData.summary_message}
        </div>
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

        {error && <div className="err flex-1 sm:max-w-md">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/dashboard/settings/ai")}
            className="btn-secondary"
            disabled={saving}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="btn-primary"
          >
            {saving ? <Spinner /> : "この内容で保存する →"}
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
