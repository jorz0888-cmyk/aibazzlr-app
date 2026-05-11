"use client";

import { useEffect } from "react";
import { Spinner } from "@/components/Spinner";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "確認",
  cancelLabel = "キャンセル",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmClass = destructive
    ? "btn-primary border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
    : "btn-primary";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur sm:p-6"
      onClick={() => {
        if (!loading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="card flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <h3
            id="confirm-dialog-title"
            className="text-base font-bold text-ink"
          >
            {title}
          </h3>
          <div className="mt-2 text-sm leading-relaxed text-ink-muted">
            {description}
          </div>
        </div>
        <footer className="shrink-0 border-t border-line bg-bg-surface/95 p-4 backdrop-blur sm:p-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`${confirmClass} w-full sm:w-auto`}
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? <Spinner /> : confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
