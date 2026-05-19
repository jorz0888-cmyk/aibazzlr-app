"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MONTHLY_GOALS,
  MONTHLY_GOAL_KEYS,
} from "@/lib/strategy/monthly-goals";
import {
  AUDIENCE_PRESETS,
  presetsForIndustry,
} from "@/lib/strategy/audience-presets";
import type { MonthlyGoalKey } from "@/lib/supabase/types";

async function patchJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

export function MarketingStrategySection({
  configId,
  industry,
  initialGoal,
  initialAudiencePreset,
  initialAudienceDescription,
}: {
  configId: string;
  industry: string | null;
  initialGoal: MonthlyGoalKey | null;
  initialAudiencePreset: string | null;
  initialAudienceDescription: string | null;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState<MonthlyGoalKey | null>(initialGoal);
  const [preset, setPreset] = useState<string | null>(initialAudiencePreset);
  const [desc, setDesc] = useState(initialAudienceDescription ?? "");
  const [saving, setSaving] = useState<"goal" | "preset" | "desc" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const availablePresets = presetsForIndustry(industry);

  async function saveGoal(next: MonthlyGoalKey | null) {
    setErr(null);
    setSaving("goal");
    const prev = goal;
    setGoal(next);
    try {
      await patchJson(`/api/ai-configs/${configId}`, { monthly_goal: next });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
      setGoal(prev);
    } finally {
      setSaving(null);
    }
  }

  async function savePreset(next: string | null) {
    setErr(null);
    setSaving("preset");
    const prev = preset;
    setPreset(next);
    try {
      await patchJson(`/api/ai-configs/${configId}`, {
        target_audience_preset: next,
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
      setPreset(prev);
    } finally {
      setSaving(null);
    }
  }

  async function saveDescription() {
    setErr(null);
    setSaving("desc");
    try {
      await patchJson(`/api/ai-configs/${configId}`, {
        target_audience_description: desc.trim() || null,
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="card space-y-6 p-5 transition hover:border-cyan/20">
      <header>
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          マーケ戦略
        </h2>
        <p className="mt-1 text-[11px] text-ink-subtle">
          目的と客層を設定すると、AI が投稿のトーン・時間帯・テーマを自動で最適化します。
          いつでも変更できます。
        </p>
      </header>

      <div className="space-y-3">
        <p className="label !mb-1">今月の目標</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {MONTHLY_GOAL_KEYS.map((key) => {
            const g = MONTHLY_GOALS[key];
            const active = goal === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => void saveGoal(active ? null : key)}
                disabled={saving === "goal"}
                className={[
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition",
                  active
                    ? "border-cyan bg-cyan/10 text-ink"
                    : "border-line text-ink-muted hover:border-cyan/40",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 font-bold">
                  <span
                    className={[
                      "grid h-4 w-4 place-items-center rounded-full border",
                      active ? "border-cyan" : "border-line-strong",
                    ].join(" ")}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-cyan" />}
                  </span>
                  {g.label}
                </span>
                <span className="text-[11px] text-ink-subtle">
                  {g.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <p className="label !mb-1">ターゲット客層</p>
        <select
          className="input"
          value={preset ?? ""}
          onChange={(e) => void savePreset(e.target.value || null)}
          disabled={saving === "preset"}
        >
          <option value="">（未設定）</option>
          {availablePresets.map((p) => {
            // Reverse-lookup the key
            const entry = Object.entries(AUDIENCE_PRESETS).find(
              ([, v]) => v === p,
            );
            const key = entry ? entry[0] : "";
            return (
              <option key={key} value={key}>
                {p.label} — {p.description}
              </option>
            );
          })}
        </select>

        <div>
          <label className="label !mb-1 block">詳細補足（任意）</label>
          <textarea
            className="input min-h-[72px]"
            rows={3}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={saveDescription}
            placeholder="例: 50代男性、日本酒好き、月2-3回来店、カウンター席で1人飲み"
          />
          <p className="mt-1 text-[10px] text-ink-subtle">
            プリセットだけでは表せない具体的な人物像があれば書いてください。AI が反映します。
          </p>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
    </section>
  );
}
