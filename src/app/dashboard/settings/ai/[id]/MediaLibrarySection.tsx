"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import type { MediaLibraryRow } from "@/lib/supabase/types";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function MediaLibrarySection({
  aiConfigId,
}: {
  aiConfigId: string;
}) {
  const [items, setItems] = useState<MediaLibraryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [detail, setDetail] = useState<MediaLibraryRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await jsonFetch<{ media: MediaLibraryRow[] }>(
        `/api/media?ai_config_id=${aiConfigId}`,
      );
      setItems(data.media);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "読み込み失敗");
    }
  }, [aiConfigId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setErr(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("ai_config_id", aiConfigId);
      for (const f of files) form.append("file", f);
      const data = await jsonFetch<{ media: MediaLibraryRow[] }>(
        "/api/media/upload",
        { method: "POST", body: form },
      );
      setItems((prev) => [...(data.media ?? []), ...(prev ?? [])]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "アップロード失敗");
    } finally {
      setUploading(false);
    }
  }

  async function removeOne(id: string) {
    if (!confirm("この写真を削除しますか？投稿に紐づいているものは影響を受けません。"))
      return;
    setErr(null);
    setItems((prev) => prev?.filter((x) => x.id !== id) ?? null);
    try {
      await jsonFetch(`/api/media/${id}`, { method: "DELETE" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除失敗");
      void reload();
    }
  }

  async function patchTags(id: string, tags: string[]) {
    setErr(null);
    setItems(
      (prev) => prev?.map((x) => (x.id === id ? { ...x, tags } : x)) ?? null,
    );
    try {
      await jsonFetch(`/api/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新失敗");
      void reload();
    }
  }

  return (
    <section className="card space-y-4 p-5 transition hover:border-cyan/20">
      <header>
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          写真ライブラリ
        </h2>
        <p className="mt-1 text-[11px] text-ink-subtle">
          写真をアップロードすると、AI が投稿内容に合う1枚を自動で選んで添付します。
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files).filter((f) =>
            f.type.startsWith("image/"),
          );
          void upload(files);
        }}
        className={[
          "rounded-lg border border-dashed p-4 text-center text-xs transition",
          dragOver
            ? "border-cyan bg-cyan/5 text-cyan"
            : "border-line text-ink-subtle hover:border-cyan/40",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/jpg"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void upload(files);
            // Reset so the same file can be reselected.
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Spinner /> : "+ 写真を追加"}
        </button>
        <p className="mt-2 text-[11px]">
          ここにドラッグ＆ドロップでもアップロードできます（jpg / png / webp、5MB まで）
        </p>
      </div>

      {err && <div className="err">{err}</div>}

      {items === null ? (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-ink-subtle">
          まだ写真がアップロードされていません。
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => setDetail(it)}
                className="group block w-full overflow-hidden rounded-lg border border-line bg-bg/40 text-left transition hover:border-cyan/40"
              >
                <div className="relative aspect-square w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.public_url}
                    alt={it.tags[0] ?? "media"}
                    className="h-full w-full object-cover transition group-hover:opacity-90"
                  />
                  {it.source === "ai_generated" && (
                    <span className="absolute left-1 top-1 rounded-full bg-cyan/80 px-1.5 py-0.5 font-mono text-[8px] tracking-widest text-bg">
                      AI
                    </span>
                  )}
                </div>
                <p className="truncate px-2 py-1 text-[11px] text-ink-muted">
                  {it.tags[0] ?? "(タグなし)"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <MediaDetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onDelete={async () => {
            await removeOne(detail.id);
            setDetail(null);
          }}
          onTagsChange={(tags) => {
            void patchTags(detail.id, tags);
            setDetail({ ...detail, tags });
          }}
        />
      )}
    </section>
  );
}

function MediaDetailModal({
  item,
  onClose,
  onDelete,
  onTagsChange,
}: {
  item: MediaLibraryRow;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  onTagsChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState(item.tags.join(", "));

  function commit() {
    const tags = draft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onTagsChange(tags);
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-bg-surface text-ink shadow-2xl sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aspect-square max-h-[50vh] w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.public_url}
            alt={item.tags[0] ?? "media"}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="space-y-3 overflow-y-auto p-5">
          <div>
            <label className="label !mb-1 block">タグ（カンマ区切り）</label>
            <input
              type="text"
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              placeholder="例: ラーメン, 醤油, 看板メニュー"
            />
            <p className="mt-1 text-[10px] text-ink-subtle">
              AI はこのタグを参考に、投稿に合う1枚を選びます。
            </p>
          </div>
          {item.ai_description && (
            <div>
              <p className="label !mb-1">AI 説明</p>
              <p className="rounded-md bg-white/5 p-2 text-xs text-ink-muted">
                {item.ai_description}
              </p>
            </div>
          )}
          <div className="font-mono text-[10px] text-ink-subtle">
            {item.source.toUpperCase()} ·{" "}
            {item.width && item.height
              ? `${item.width}×${item.height} ·`
              : ""}{" "}
            {item.file_size_bytes
              ? `${Math.round(item.file_size_bytes / 1024)} KB`
              : ""}
          </div>
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            className="btn-secondary text-danger"
            onClick={onDelete}
          >
            削除
          </button>
        </footer>
      </div>
    </div>
  );
}
