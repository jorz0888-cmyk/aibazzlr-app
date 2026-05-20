"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";

const PRESETS: Array<{ value: number; label: string; hint: string }> = [
  { value: 140, label: "140 文字", hint: "X 全角・安全側" },
  { value: 280, label: "280 文字", hint: "X 標準" },
  { value: 1000, label: "1,000 文字", hint: "X Premium" },
  { value: 4000, label: "4,000 文字", hint: "X Premium" },
  { value: 25000, label: "25,000 文字", hint: "X Premium+" },
];

const PRESET_VALUES = new Set(PRESETS.map((p) => p.value));

export function MaxPostLengthEditor({
  configId,
  initial,
}: {
  configId: string;
  initial: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const startsCustom = !PRESET_VALUES.has(initial);
  const [mode, setMode] = useState<"preset" | "custom">(
    startsCustom ? "custom" : "preset",
  );
  const [selected, setSelected] = useState<number>(initial);
  const [customStr, setCustomStr] = useState<string>(
    startsCustom ? String(initial) : "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function applyValue(next: number) {
    if (next === initial) return;
    if (!Number.isFinite(next) || next < 50 || next > 25000) {
      setErr("50〜25,000 の範囲で指定してください");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-configs/${configId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_post_length: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("保存しました", { description: "投稿の最大文字数" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
      setSelected(initial); // roll back
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="pt-1 text-xs text-ink-muted">投稿の最大文字数</span>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = mode === "preset" && selected === p.value;
            return (
              <button
                key={p.value}
                type="button"
                disabled={saving}
                onClick={() => {
                  setMode("preset");
                  setSelected(p.value);
                  void applyValue(p.value);
                }}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs transition",
                  active
                    ? "border-cyan bg-cyan/15 text-cyan"
                    : "border-line text-ink-muted hover:border-cyan/40",
                ].join(" ")}
              >
                {p.label}
                <span className="ml-1 text-[10px] text-ink-subtle">
                  {p.hint}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setMode("custom");
              setCustomStr(String(initial));
            }}
            className={[
              "rounded-full border px-3 py-1.5 text-xs transition",
              mode === "custom"
                ? "border-cyan bg-cyan/15 text-cyan"
                : "border-line text-ink-muted hover:border-cyan/40",
            ].join(" ")}
          >
            カスタム
          </button>
        </div>

        {mode === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={50}
              max={25000}
              step={1}
              className="input w-32"
              value={customStr}
              onChange={(e) => setCustomStr(e.target.value)}
              placeholder="280"
              disabled={saving}
            />
            <span className="text-xs text-ink-muted">文字</span>
            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              disabled={saving}
              onClick={() => {
                const n = Number(customStr);
                if (!Number.isInteger(n)) {
                  setErr("整数で指定してください");
                  return;
                }
                setSelected(n);
                void applyValue(n);
              }}
            >
              {saving ? <Spinner size={12} /> : "適用"}
            </button>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-subtle">
          X Premium 未加入の場合は <b>280文字</b> を選択してください。<br />
          投稿本文・ハッシュタグ・区切り文字を含めた合計に対する上限です。
        </p>

        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  );
}
