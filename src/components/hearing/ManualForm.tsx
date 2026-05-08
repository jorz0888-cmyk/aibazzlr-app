"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { TagInput } from "./TagInput";
import { INDUSTRY_OPTIONS } from "./IndustrySelectCard";
import type { AiConfig } from "@/lib/supabase/types";

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  initial?: AiConfig | null;
};

const VOICE_TONES = [
  { value: "casual_polite", label: "カジュアル丁寧" },
  { value: "friendly_polite", label: "フレンドリー丁寧" },
  { value: "energetic_polite", label: "エネルギッシュ丁寧" },
  { value: "professional_polite", label: "プロフェッショナル" },
  { value: "calm_polite", label: "落ち着き丁寧" },
];

export function ManualForm({ mode, initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [businessName, setBusinessName] = useState(
    initial?.business_name ?? "",
  );
  const [personaRole, setPersonaRole] = useState(initial?.persona_role ?? "");
  const [worldView, setWorldView] = useState(initial?.world_view ?? "");
  const [voiceTone, setVoiceTone] = useState(initial?.voice_tone ?? "");
  const [target, setTarget] = useState(initial?.target_audience ?? "");
  const [must, setMust] = useState<string[]>(
    initial?.must_include_elements ?? [],
  );
  const [ng, setNg] = useState<string[]>(initial?.ng_words ?? []);
  const [examples, setExamples] = useState<string[]>(
    initial?.good_examples ?? [],
  );
  const [hashtagPool, setHashtagPool] = useState<string[]>(
    initial?.hashtag_pool ?? [],
  );
  const [postingFrequency, setPostingFrequency] = useState(
    initial?.posting_frequency ?? "",
  );
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);

  const [example, setExample] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addExample() {
    const t = example.trim();
    if (!t) return;
    if (examples.length >= 5) return;
    setExamples([...examples, t]);
    setExample("");
  }

  function removeExample(i: number) {
    setExamples(examples.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || name.length > 30) {
      setError("名前は1〜30文字で入力してください。");
      return;
    }
    if (examples.length === 0) {
      setError("良い投稿例を最低1個は登録してください。");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        industry: industry || null,
        business_name: businessName || null,
        persona_role: personaRole || null,
        world_view: worldView || null,
        voice_tone: voiceTone || null,
        target_audience: target || null,
        must_include_elements: must,
        ng_words: ng,
        good_examples: examples,
        hashtag_pool: hashtagPool,
        posting_frequency: postingFrequency || null,
        is_default: isDefault,
      };

      const url =
        mode === "create"
          ? "/api/ai-configs"
          : `/api/ai-configs/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/dashboard/settings/ai/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="基本情報">
        <Field label="設定の名前" required hint="1〜30文字">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            maxLength={30}
            required
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="業種" required>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="input"
              required
            >
              <option value="">選択してください</option>
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.emoji} {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ビジネス名">
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <Field label="投稿者の役割" hint="例：店主、スタイリスト">
          <input
            type="text"
            value={personaRole}
            onChange={(e) => setPersonaRole(e.target.value)}
            className="input"
          />
        </Field>
      </Section>

      <Section title="世界観・トーン">
        <Field label="世界観" hint="30文字以上推奨">
          <textarea
            value={worldView}
            onChange={(e) => setWorldView(e.target.value)}
            className="input min-h-[140px]"
            rows={5}
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
              {VOICE_TONES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ターゲット読者">
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input"
            />
          </Field>
        </div>
      </Section>

      <Section title="必須要素・NGワード">
        <Field label="必須要素" hint="最低3個推奨・最大5個">
          <TagInput
            value={must}
            onChange={setMust}
            max={5}
            placeholder="必須要素を入力してEnter"
          />
        </Field>

        <Field label="NGワード" hint="最大10個">
          <TagInput
            value={ng}
            onChange={setNg}
            max={10}
            variant="danger"
            placeholder="NGワードを入力してEnter"
          />
        </Field>
      </Section>

      <Section title="良い投稿例" hint="最低1個必須・最大5個">
        <div className="space-y-2">
          {examples.map((ex, i) => (
            <div
              key={i}
              className="card flex items-start gap-2 p-3 text-sm text-ink"
            >
              <span className="font-mono text-[10px] text-ink-subtle">
                #{i + 1}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{ex}</span>
              <button
                type="button"
                onClick={() => removeExample(i)}
                className="text-ink-subtle hover:text-danger"
                aria-label="削除"
              >
                ×
              </button>
            </div>
          ))}

          {examples.length < 5 && (
            <div className="flex gap-2">
              <textarea
                value={example}
                onChange={(e) => setExample(e.target.value)}
                placeholder="良い投稿例を入力..."
                className="input flex-1 min-h-[80px]"
              />
              <button
                type="button"
                onClick={addExample}
                disabled={!example.trim()}
                className="btn-secondary self-stretch"
              >
                追加
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title="ハッシュタグ・配信" hint="最大10個">
        <Field label="ハッシュタグプール">
          <TagInput
            value={hashtagPool}
            onChange={setHashtagPool}
            max={10}
            placeholder="#ハッシュタグ を入力してEnter"
          />
        </Field>

        <Field label="投稿頻度・時間帯" hint="例：毎日 8:00 / 19:00">
          <input
            type="text"
            value={postingFrequency}
            onChange={(e) => setPostingFrequency(e.target.value)}
            className="input"
          />
        </Field>
      </Section>

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
            onClick={() => router.back()}
            className="btn-secondary"
            disabled={saving}
          >
            キャンセル
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Spinner /> : mode === "create" ? "作成する" : "更新する"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-[11px] text-ink-subtle">{hint}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label flex items-center justify-between">
        <span>
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </span>
        {hint && (
          <span className="font-normal normal-case text-ink-subtle">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
