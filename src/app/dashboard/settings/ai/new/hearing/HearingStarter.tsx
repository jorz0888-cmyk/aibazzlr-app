"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  INDUSTRY_OPTIONS,
  IndustrySelectCard,
} from "@/components/hearing/IndustrySelectCard";
import { Spinner } from "@/components/Spinner";

export function HearingStarter() {
  const router = useRouter();
  const search = useSearchParams();
  const initial = search.get("industry") ?? "";
  const [industry, setIndustry] = useState<string>(
    INDUSTRY_OPTIONS.find((o) => o.key === initial)?.key ?? "",
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/ai-hearing/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry: industry || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      router.push(`/dashboard/settings/ai/new/hearing/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始に失敗しました");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {INDUSTRY_OPTIONS.map((o) => (
          <IndustrySelectCard
            key={o.key}
            option={o}
            selected={industry === o.key}
            onSelect={() => setIndustry(o.key)}
          />
        ))}
      </div>

      {error && <div className="err">{error}</div>}

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
