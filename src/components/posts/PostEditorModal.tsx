"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { TagInput } from "@/components/hearing/TagInput";
import type { PostListItem } from "./types";

const MAX_LEN = 280;

export function PostEditorModal({
  post,
  open,
  onClose,
}: {
  post: PostListItem;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState(post.content);
  const [hashtags, setHashtags] = useState<string[]>(post.hashtags ?? []);
  const [theme, setTheme] = useState(post.theme ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const tagsText = hashtags.join(" ");
  const totalLen = (tagsText ? content + "\n\n" + tagsText : content).length;
  const over = totalLen > MAX_LEN;

  async function save() {
    if (over) {
      setError(`280文字を超えています（${totalLen}文字）`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          hashtags,
          theme: theme.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
            ── EDIT DRAFT
          </p>
          <h2 className="mt-1 text-lg font-bold text-ink">投稿を編集</h2>
        </div>

        <div>
          <label className="label">本文</label>
          <textarea
            className="input min-h-[140px]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
          />
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span
              className={over ? "text-danger" : "text-ink-subtle"}
            >
              {totalLen} / {MAX_LEN} 文字（本文 + ハッシュタグ）
            </span>
          </div>
        </div>

        <div>
          <label className="label">ハッシュタグ</label>
          <TagInput value={hashtags} onChange={setHashtags} max={10} />
        </div>

        <div>
          <label className="label">テーマ（任意）</label>
          <input
            className="input"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>

        {error && <div className="err">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={saving || over}
          >
            {saving ? <Spinner /> : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
