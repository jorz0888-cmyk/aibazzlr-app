"use client";

/**
 * Inline editable fields for the AI-config detail page.
 *
 * Each field manages its own local state, edit mode, and save call to
 * PATCH /api/ai-configs/[id]. They're built as small client components so
 * the surrounding page can stay a server component for SSR + auth.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { TagInput } from "@/components/hearing/TagInput";

type ApiError = {
  error?: string;
  debug?: { code?: string | null; message?: string | null; hint?: string | null };
};

async function patchConfig(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/ai-configs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    const codePart = body.debug?.code ? `[${body.debug.code}] ` : "";
    throw new Error(`${codePart}${body.error ?? `HTTP ${res.status}`}`);
  }
}

// ---------------------------------------------------------------------------
// Single-line text
// ---------------------------------------------------------------------------
export function EditableText({
  configId,
  field,
  initial,
  label,
  placeholder,
}: {
  configId: string;
  field: string;
  initial: string | null;
  label: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await patchConfig(configId, { [field]: value.trim() || null });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(initial ?? "");
    setError(null);
    setEditing(false);
  }

  return (
    <div className="grid grid-cols-[140px_1fr_auto] items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="text-xs text-ink-muted">{label}</span>
      {editing ? (
        <>
          <input
            type="text"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
          />
          <div className="flex gap-1">
            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Spinner size={12} /> : "保存"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={cancel}
              disabled={saving}
            >
              ×
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-sm text-ink">
            {value || <span className="text-ink-subtle">—</span>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
          >
            ✎ 編集
          </button>
        </>
      )}
      {error && <div className="col-span-3 text-xs text-danger">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-line textarea
// ---------------------------------------------------------------------------
export function EditableTextarea({
  configId,
  field,
  initial,
  label,
  placeholder,
  rows = 6,
}: {
  configId: string;
  field: string;
  initial: string | null;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await patchConfig(configId, { [field]: value.trim() || null });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(initial ?? "");
    setError(null);
    setEditing(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">{label}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
          >
            ✎ 編集
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="input min-h-[120px]"
            rows={rows}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Spinner size={14} /> : "保存"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={cancel}
              disabled={saving}
            >
              キャンセル
            </button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap rounded-lg border border-line bg-bg/40 p-3 text-sm leading-relaxed text-ink">
          {value || <span className="text-ink-subtle">—</span>}
        </p>
      )}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag-array (text[]) editor
// ---------------------------------------------------------------------------
export function EditableTags({
  configId,
  field,
  initial,
  label,
  variant = "cyan",
  max,
}: {
  configId: string;
  field: string;
  initial: string[];
  label: string;
  variant?: "cyan" | "danger" | "muted";
  max?: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await patchConfig(configId, { [field]: tags });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setTags(initial);
    setError(null);
    setEditing(false);
  }

  const tagClass =
    variant === "danger"
      ? "border-danger/30 bg-danger/10 text-danger"
      : variant === "muted"
        ? "border-line-strong bg-white/5 text-ink"
        : "border-cyan/30 bg-cyan/10 text-cyan";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">
          {label}{" "}
          <span className="font-normal text-ink-subtle">({tags.length})</span>
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
          >
            ✎ 編集
          </button>
        )}
      </div>

      {editing ? (
        <>
          <TagInput
            value={tags}
            onChange={setTags}
            max={max}
            variant={variant}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Spinner size={14} /> : "保存"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={cancel}
              disabled={saving}
            >
              キャンセル
            </button>
          </div>
        </>
      ) : tags.length === 0 ? (
        <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm text-ink-subtle">
          未登録
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={`${t}-${i}`}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${tagClass}`}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-line list (each entry is its own card; suited for good_examples /
// real_episodes where lines can be multi-sentence)
// ---------------------------------------------------------------------------
export function EditableLines({
  configId,
  field,
  initial,
  label,
  placeholder,
}: {
  configId: string;
  field: string;
  initial: string[];
  label: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addDraft() {
    const t = draft.trim();
    if (!t) return;
    setItems([...items, t]);
    setDraft("");
  }
  function removeAt(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await patchConfig(configId, { [field]: items });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setItems(initial);
    setDraft("");
    setError(null);
    setEditing(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">
          {label}{" "}
          <span className="font-normal text-ink-subtle">({items.length})</span>
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
          >
            ✎ 編集
          </button>
        )}
      </div>

      {editing ? (
        <>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li
                key={i}
                className="card flex items-start gap-2 p-3 text-sm text-ink"
              >
                <span className="font-mono text-[10px] text-ink-subtle">
                  #{i + 1}
                </span>
                <span className="flex-1 whitespace-pre-wrap">{it}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-ink-subtle hover:text-danger"
                  aria-label="削除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder ?? "1件入力..."}
              className="input min-h-[60px] flex-1"
            />
            <button
              type="button"
              onClick={addDraft}
              disabled={!draft.trim()}
              className="btn-secondary self-stretch"
            >
              追加
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Spinner size={14} /> : "保存"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={cancel}
              disabled={saving}
            >
              キャンセル
            </button>
          </div>
        </>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm text-ink-subtle">
          未登録
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="rounded-lg border border-line bg-bg/40 p-3 text-sm leading-relaxed text-ink"
            >
              <span className="mr-2 font-mono text-[11px] text-ink-subtle">
                #{i + 1}
              </span>
              <span className="whitespace-pre-wrap">{it}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
