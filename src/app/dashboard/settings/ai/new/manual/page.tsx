import { ManualForm } from "@/components/hearing/ManualForm";

export default function ManualNewPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── MANUAL FORM
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          AI設定を手動で作成
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          全項目を直接入力します。後からいつでも編集・削除できます。
        </p>
      </div>

      <ManualForm mode="create" />
    </div>
  );
}
