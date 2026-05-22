"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";
import type { MediaLibraryRow } from "@/lib/supabase/types";

import { friendlyErrorMessage } from "@/lib/errors/client";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(friendlyErrorMessage(data));
  return data;
}

export function MediaLibrarySection({
  aiConfigId,
  initialImageGenEnabled,
}: {
  aiConfigId: string;
  initialImageGenEnabled: boolean;
}) {
  const toast = useToast();
  const [items, setItems] = useState<MediaLibraryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [detail, setDetail] = useState<MediaLibraryRow | null>(null);
  const [imageGenEnabled, setImageGenEnabled] = useState(
    initialImageGenEnabled,
  );
  const [savingToggle, setSavingToggle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function toggleImageGeneration(next: boolean) {
    setErr(null);
    setSavingToggle(true);
    const prev = imageGenEnabled;
    setImageGenEnabled(next);
    try {
      await jsonFetch(`/api/ai-configs/${aiConfigId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_generation_enabled: next }),
      });
      toast.success(
        next ? "画像生成を ON にしました" : "画像生成を OFF にしました",
        {
          description: next
            ? "投稿に自動で画像が添付されます（ライブラリ→AI生成の順）"
            : "投稿はテキストのみになります",
        },
      );
    } catch (e) {
      setImageGenEnabled(prev);
      setErr(e instanceof Error ? e.message : "切替に失敗しました");
    } finally {
      setSavingToggle(false);
    }
  }

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
    if (
      !confirm(
        "この写真を削除しますか？投稿済みの投稿には影響しません（未投稿のドラフトに紐づいていた場合は画像なしで投稿されます）。",
      )
    )
      return;
    setErr(null);
    setItems((prev) => prev?.filter((x) => x.id !== id) ?? null);
    try {
      await jsonFetch(`/api/media/${id}`, { method: "DELETE" });
      toast.success("写真を削除しました");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除失敗");
      toast.error("写真の削除に失敗しました", {
        description: e instanceof Error ? e.message : undefined,
      });
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            写真ライブラリ
          </h2>
          <p className="mt-1 text-[11px] text-ink-subtle">
            写真をアップロードすると、AI が自動でタグ付け→投稿内容に合う1枚を選んで添付します。
            ライブラリが空でも、有料プランなら AI が画像を自動生成して添付します。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {items && items.some((m) => !m.ai_description) && (
            <BackfillButton onDone={reload} />
          )}
          <label className="flex shrink-0 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={imageGenEnabled}
              disabled={savingToggle}
              onChange={(e) => void toggleImageGeneration(e.target.checked)}
            />
            <span
              className={
                imageGenEnabled ? "font-bold text-cyan" : "text-ink-muted"
              }
            >
              画像生成 {imageGenEnabled ? "ON" : "OFF"}
            </span>
          </label>
        </div>
      </header>

      {!imageGenEnabled && (
        <div className="rounded-md border border-line bg-white/5 p-3 text-[11px] leading-relaxed text-ink-muted">
          画像生成は <b className="text-ink">OFF</b> になっています。
          ドラフト生成・自動投稿はテキストのみで実行され、ライブラリの写真や
          AI画像生成は使用しません（写真のアップロード自体は引き続き可能です）。
        </div>
      )}

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
            <li
              key={it.id}
              className="group relative overflow-hidden rounded-lg border border-line bg-bg/40 transition hover:border-cyan/40"
            >
              <button
                type="button"
                onClick={() => setDetail(it)}
                className="block w-full text-left"
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
                  {it.tags.length === 0
                    ? "(タグなし)"
                    : it.tags.length === 1
                      ? it.tags[0]
                      : (
                        <>
                          {it.tags[0]}
                          <span className="ml-1 text-ink-subtle">
                            +{it.tags.length - 1}
                          </span>
                        </>
                      )}
                </p>
              </button>
              {/* Phase: per-thumbnail × delete. Always visible on touch
                  devices; fades in on hover for desktop where space is
                  cheaper. Sits outside the open-detail button so taps
                  don't double-trigger. */}
              <button
                type="button"
                aria-label="この写真を削除"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeOne(it.id);
                }}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full border border-line-strong bg-black/70 text-ink shadow-md opacity-100 transition hover:border-danger hover:text-danger md:opacity-0 md:group-hover:opacity-100"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  aria-hidden
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
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

function BackfillButton({ onDone }: { onDone: () => void | Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<
    | null
    | { processed: number; succeeded: number; failed: number; remaining: number }
  >(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setRunning(true);
    setProgress(null);
    try {
      let total = { processed: 0, succeeded: 0, failed: 0 };
      let remaining = 0;
      // Re-run batches until nothing's left without ai_description.
      for (let round = 0; round < 20; round++) {
        const data = await jsonFetch<{
          processed: number;
          succeeded: number;
          failed: number;
          remaining_after_batch: number;
        }>("/api/media/backfill-tags", { method: "POST" });
        total = {
          processed: total.processed + data.processed,
          succeeded: total.succeeded + data.succeeded,
          failed: total.failed + data.failed,
        };
        remaining = data.remaining_after_batch;
        setProgress({ ...total, remaining });
        if (data.processed === 0 || remaining === 0) break;
      }
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={run}
        disabled={running}
      >
        {running ? <Spinner /> : "🔄 全写真にタグを自動付与"}
      </button>
      {progress && (
        <p className="font-mono text-[10px] text-ink-subtle">
          {progress.succeeded} 成功 / {progress.failed} 失敗
          {progress.remaining > 0 ? ` / 残り ${progress.remaining}` : ""}
        </p>
      )}
      {err && <p className="text-[10px] text-danger">{err}</p>}
    </div>
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
