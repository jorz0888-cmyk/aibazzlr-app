"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function ConfigDetailActions({
  configId,
  isDefault,
}: {
  configId: string;
  isDefault: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<null | "default" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function setAsDefault() {
    if (loading) return;
    setError(null);
    setLoading("default");
    try {
      const res = await fetch(`/api/ai-configs/${configId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setLoading(null);
    }
  }

  async function remove() {
    if (loading) return;
    setError(null);
    setLoading("delete");
    try {
      const res = await fetch(`/api/ai-configs/${configId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDeleteOpen(false);
      router.push("/dashboard/settings/ai");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/dashboard/settings/ai/${configId}/edit`}
          className="btn-secondary"
        >
          編集
        </Link>
        {!isDefault && (
          <button
            type="button"
            onClick={setAsDefault}
            disabled={loading !== null}
            className="btn-secondary"
          >
            {loading === "default" ? <Spinner size={14} /> : "デフォルトに設定"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          disabled={loading !== null}
          className="btn-secondary border-danger/30 text-danger hover:bg-danger/10"
        >
          {loading === "delete" ? <Spinner size={14} /> : "削除"}
        </button>
      </div>
      {error && <div className="text-xs text-danger">{error}</div>}

      <ConfirmDialog
        open={deleteOpen}
        title="AI設定を削除"
        description="このAI設定を削除しますか？元に戻せません。"
        confirmLabel="削除する"
        destructive
        loading={loading === "delete"}
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
