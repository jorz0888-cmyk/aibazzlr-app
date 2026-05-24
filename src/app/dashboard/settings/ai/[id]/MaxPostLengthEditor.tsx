"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/common/Toast";

// 2026-05-24 #D: preset values are X-weighted counts (the unit
// max_post_length stores). The previous label "{count}文字"
// suggested "{count} Japanese characters", so a user picking 280
// thought "I can write 280 JP chars" and got cut at the actual
// 140-JP-char limit. Labels are now anchored on the JP-char
// equivalent (≈ count / 2 for JP-centric content) with the raw
// count in parentheses for transparency. Stored value unchanged.
const PRESETS: Array<{ value: number; label: string; hint: string }> = [
  {
    value: 140,
    label: "日本語約70字",
    hint: "控えめ（140カウント）",
  },
  {
    value: 280,
    label: "日本語約140字",
    hint: "X 通常アカウントの実上限（280カウント・推奨）",
  },
  {
    value: 1000,
    label: "日本語約500字",
    hint: "X Premium 必須（1,000カウント）",
  },
  {
    value: 4000,
    label: "日本語約2,000字",
    hint: "X Premium 必須（4,000カウント）",
  },
  {
    value: 25000,
    label: "日本語約12,500字",
    hint: "X Premium+（25,000カウント）",
  },
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
      toast.success("保存しました", {
        description: "投稿の最大カウント (X基準)",
      });
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
      <span className="pt-1 text-xs text-ink-muted">
        投稿の最大カウント
        <br />
        <span className="font-mono text-[10px] text-ink-subtle">(X基準)</span>
      </span>
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
            <span className="text-xs text-ink-muted">カウント (X基準)</span>
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
          <b className="text-ink">X の数え方（カウント）</b>：日本語などの全角は
          1文字を2としてカウント、半角英数は1文字を1としてカウント、URLは長さに
          関わらず23でカウントします。X 通常アカウントの実上限は{" "}
          <b className="text-ink">280 カウント</b>（= 日本語約140字）です。
          <br />
          <b className="text-ink">日本語中心・通常アカウント</b> なら{" "}
          <b className="text-cyan">280 カウント（日本語約140字・推奨）</b>{" "}
          が X の実上限ぴったりで標準。140 カウント（日本語約70字）は
          余裕を見たい短文向け。1,000 以上のカウントは X Premium が必要です。
          <br />
          投稿本文・ハッシュタグ・区切り文字を含めた合計が上限です。
        </p>

        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  );
}
