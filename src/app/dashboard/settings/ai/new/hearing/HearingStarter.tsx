"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  industriesFor,
  IndustrySelectCard,
} from "@/components/hearing/IndustrySelectCard";
import { Spinner } from "@/components/Spinner";
import type { AccountMode } from "@/lib/supabase/types";

type Step = "mode" | "industry";

export function HearingStarter() {
  const router = useRouter();
  const search = useSearchParams();
  const initialIndustry = search.get("industry") ?? "";
  // If a query param hints at a starting industry, jump straight to industry step.
  const [step, setStep] = useState<Step>(
    initialIndustry ? "industry" : "mode",
  );
  const [mode, setMode] = useState<AccountMode>("real");
  const [industry, setIndustry] = useState<string>(initialIndustry);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = industriesFor(mode);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-hearing/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: industry || null,
          account_mode: mode,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            sessionId?: string;
            error?: string;
            // 2026-05-23 T3: quota responses include a JP `message`
            // alongside the legacy `error` code. Prefer the message
            // when present so users don't see "daily_quota_exceeded".
            message?: string;
            debug?: { code?: string | null; hint?: string | null };
          }
        | null;
      if (!res.ok) {
        if (body?.message) {
          // The server-provided JP copy already includes reset time +
          // remediation; surface it verbatim.
          throw new Error(body.message);
        }
        const detail = body?.debug?.code
          ? ` (code: ${body.debug.code}${body.debug.hint ? ` / hint: ${body.debug.hint}` : ""})`
          : "";
        throw new Error(`${body?.error ?? `HTTP ${res.status}`}${detail}`);
      }
      if (!body?.sessionId) {
        throw new Error("サーバから sessionId が返されませんでした");
      }
      router.push(`/dashboard/settings/ai/new/hearing/${body.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始に失敗しました");
      setStarting(false);
    }
  }

  if (step === "mode") {
    return (
      <ModeStep
        selected={mode}
        onSelect={(m) => {
          setMode(m);
          setStep("industry");
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="card flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 text-sm">
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] tracking-widest",
              mode === "real"
                ? "border border-cyan/30 bg-cyan/10 text-cyan"
                : "border border-accent/30 bg-accent/10 text-accent",
            ].join(" ")}
          >
            {mode === "real" ? "🏪 実在モード" : "🎭 架空モード"}
          </span>
          <span className="text-xs text-ink-muted">
            {mode === "real"
              ? "実在のお店・サービス向け（捏造禁止モード）"
              : "個人ブランディング・キャラ運用向け（v14スタイル）"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setStep("mode");
            setIndustry("");
          }}
          className="btn-ghost"
        >
          モードを変える
        </button>
      </div>

      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── STEP 1 / {mode === "real" ? "業種選択" : "タイプ選択"}
        </p>
        <h2 className="mt-1 text-lg font-bold text-ink">
          {mode === "real"
            ? "お店の業種を選んでください"
            : "ブランドのタイプを選んでください"}
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <IndustrySelectCard
            key={o.key}
            option={o}
            selected={industry === o.key}
            onSelect={() => setIndustry(o.key)}
            variant={mode === "fictional" ? "accent" : "cyan"}
          />
        ))}
      </div>

      {error && (
        <div className="err whitespace-pre-line">{error}</div>
      )}

      <div className="card flex items-center justify-between p-5">
        <div className="text-xs text-ink-muted">
          所要時間の目安：<span className="text-ink">10〜15分</span>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="btn-primary"
        >
          {starting ? <Spinner /> : "ヒアリングを始める →"}
        </button>
      </div>
    </div>
  );
}

function ModeStep({
  selected,
  onSelect,
}: {
  selected: AccountMode;
  onSelect: (m: AccountMode) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── STEP 0 / 業種選択の前に
        </p>
        <h2 className="mt-1 text-lg font-bold text-ink">
          どんなアカウントを作りますか？
        </h2>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ModeCard
          mode="real"
          emoji="🏪"
          title="実在モード"
          subtitle="お店やサービスを宣伝する"
          examples={["飲食店", "美容室", "整体", "教室", "士業", "小売"]}
          variant="cyan"
          selected={selected === "real"}
          onSelect={() => onSelect("real")}
        />
        <ModeCard
          mode="fictional"
          emoji="🎭"
          title="架空モード"
          subtitle="個人ブランディング・キャラ運用"
          examples={["副業発信", "知識系キャラ", "占い", "コーチ", "哲学", "エンタメ"]}
          variant="accent"
          selected={selected === "fictional"}
          onSelect={() => onSelect("fictional")}
        />
      </div>

      <div className="card border-cyan/20 bg-cyan/5 p-4 text-xs text-ink-muted">
        ⚠️ <span className="text-ink">実在モード</span> では、捏造された人物や架空のエピソードは生成されません。
        実情報をベースに、お店の魅力を発信します。
      </div>
    </div>
  );
}

function ModeCard({
  mode: _mode,
  emoji,
  title,
  subtitle,
  examples,
  variant,
  selected,
  onSelect,
}: {
  mode: AccountMode;
  emoji: string;
  title: string;
  subtitle: string;
  examples: string[];
  variant: "cyan" | "accent";
  selected: boolean;
  onSelect: () => void;
}) {
  const accentTextClass = variant === "cyan" ? "text-cyan" : "text-accent";
  const borderClass =
    variant === "cyan"
      ? selected
        ? "border-cyan/60 bg-cyan/5 shadow-cyan"
        : "hover:border-cyan/30"
      : selected
        ? "border-accent/60 bg-accent/5"
        : "hover:border-accent/30";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "card group flex flex-col items-start gap-4 p-7 text-left transition",
        borderClass,
      ].join(" ")}
    >
      <div className="text-4xl">{emoji}</div>
      <div>
        <h3 className={`text-xl font-extrabold ${accentTextClass}`}>{title}</h3>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      </div>
      <ul className="grid grid-cols-2 gap-1.5 text-xs text-ink-muted">
        {examples.map((e) => (
          <li key={e} className="flex items-center gap-1.5">
            <span className={`text-[10px] ${accentTextClass}`}>●</span>
            {e}
          </li>
        ))}
      </ul>
      <div
        className={`mt-2 inline-flex items-center gap-1 text-sm font-bold ${accentTextClass}`}
      >
        選ぶ
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
