"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";
import { friendlyErrorMessage } from "@/lib/errors/client";
import type { ContentPillar } from "@/lib/supabase/types";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(friendlyErrorMessage(data));
  return data;
}

/**
 * Phase 17: per-AI-config content-pillar editor.
 *
 * Pillars are 8 distinct angles the post generator rotates through via
 * anti-recency selection. Initial set is LLM-generated on first post
 * (and via the regen button here); users can hand-tweak names /
 * descriptions or add/remove pillars at will.
 *
 * The list edits live in local state; "保存" PUTs the whole array.
 * Save replaces the row (no per-pillar diff sync) — pillar ids are
 * preserved so anti-recency history continues to apply to renamed
 * pillars as long as the id stays the same.
 */
export function ContentPillarsSection({
  aiConfigId,
  initialPillars,
}: {
  aiConfigId: string;
  initialPillars: ContentPillar[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pillars, setPillars] = useState<ContentPillar[]>(initialPillars);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function mutate(next: ContentPillar[]) {
    setPillars(next);
    setDirty(true);
  }

  function updateAt(index: number, patch: Partial<ContentPillar>) {
    mutate(
      pillars.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  }

  function remove(index: number) {
    mutate(pillars.filter((_, i) => i !== index));
  }

  function addNew() {
    mutate([
      ...pillars,
      // Empty id signals to the API "assign a stable slug for me".
      { id: "", name: "", description: "" },
    ]);
  }

  async function save() {
    setErr(null);
    // Drop completely-empty rows the user added but never filled in.
    const cleaned = pillars
      .map((p) => ({
        id: p.id,
        name: (p.name ?? "").trim(),
        description: (p.description ?? "").trim(),
      }))
      .filter((p) => p.name.length > 0);
    setSaving(true);
    try {
      const data = await jsonFetch<{ pillars: ContentPillar[] }>(
        `/api/ai-configs/${aiConfigId}/pillars`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pillars: cleaned }),
        },
      );
      setPillars(data.pillars);
      setDirty(false);
      toast.success("コンテンツの柱を保存しました");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (
      pillars.length > 0 &&
      !confirm(
        "AI に柱を作り直させます。現在の柱（編集中の変更含む）は上書きされます。よろしいですか？",
      )
    ) {
      return;
    }
    setErr(null);
    setRegenerating(true);
    try {
      const data = await jsonFetch<{ pillars: ContentPillar[] }>(
        `/api/ai-configs/${aiConfigId}/pillars`,
        { method: "POST" },
      );
      setPillars(data.pillars);
      setDirty(false);
      toast.success("コンテンツの柱を再生成しました", {
        description: `${data.pillars.length} 個の柱を作成`,
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "再生成に失敗しました");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="card space-y-4 p-5 transition hover:border-cyan/20">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            コンテンツの柱
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            投稿は毎回ここから 1 つを選んで生成されます。直近2投稿の柱は
            自動で除外され、しばらく使っていない柱ほど選ばれやすくなります。
            未設定の場合は次の投稿生成時に AI が自動で作成します。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating || saving}
            className="btn-secondary text-xs"
          >
            {regenerating ? <Spinner size={12} /> : "🪄 AI で再生成"}
          </button>
        </div>
      </header>

      {pillars.length === 0 ? (
        <div className="rounded-md border border-dashed border-line p-4 text-center text-xs text-ink-subtle">
          柱が未設定です。「AI で再生成」を押すか、下から手動で追加できます。
        </div>
      ) : (
        <ul className="space-y-2">
          {pillars.map((p, i) => (
            <li
              key={p.id || `new-${i}`}
              className="rounded-lg border border-line bg-white/5 p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan/15 font-mono text-[10px] text-cyan">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    type="text"
                    className="input"
                    value={p.name}
                    placeholder="柱の名前（例: 昔話）"
                    onChange={(e) =>
                      updateAt(i, { name: e.target.value })
                    }
                  />
                  <textarea
                    className="input min-h-[60px] text-xs"
                    value={p.description}
                    placeholder="具体的な切り口（例: 2000年代以前のアキバの情景を一人称で語る）"
                    onChange={(e) =>
                      updateAt(i, { description: e.target.value })
                    }
                    rows={2}
                  />
                  {p.id && (
                    <p className="font-mono text-[10px] text-ink-subtle">
                      id: {p.id}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={saving || regenerating}
                  className="rounded-full border border-line-strong p-1 text-ink-subtle hover:border-danger hover:text-danger"
                  aria-label="削除"
                  title="削除"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addNew}
          disabled={saving || regenerating}
          className="btn-secondary text-xs"
        >
          + 柱を追加
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving || regenerating}
          className="btn-primary text-xs"
        >
          {saving ? <Spinner size={12} /> : dirty ? "保存" : "保存済"}
        </button>
        {dirty && (
          <span className="text-[10px] text-warning">未保存の変更があります</span>
        )}
      </div>

      {err && <p className="text-xs text-danger">{err}</p>}
    </section>
  );
}
