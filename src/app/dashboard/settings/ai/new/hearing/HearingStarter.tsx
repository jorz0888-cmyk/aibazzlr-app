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
      const body = (await res.json().catch(() => null)) as
        | {
            sessionId?: string;
            error?: string;
            debug?: { code?: string | null; hint?: string | null };
          }
        | null;

      if (!res.ok) {
        const detail = body?.debug?.code
          ? ` (code: ${body.debug.code}${body.debug.hint ? ` / hint: ${body.debug.hint}` : ""})`
          : "";
        throw new Error(`${body?.error ?? `HTTP ${res.status}`}${detail}`);
      }

      if (!body?.sessionId) {
        throw new Error(
          "サーバから sessionId が返されませんでした",
        );
      }

      router.push(`/dashboard/settings/ai/new/hearing/${body.sessionId}`);
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
