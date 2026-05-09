"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { TweetPreview } from "./TweetPreview";

type Result = {
  tweet: string;
  image_concept?: string | null;
  theme_summary?: string | null;
};

const LOADING_LINES = [
  "あなたのAIが投稿を考えています...",
  "ブランドの世界観を呼び出し中...",
  "今日のテーマを選んでいます...",
  "言葉を選びぬいています...",
];

export function TestPostGenerator({
  sessionId,
  brandName,
}: {
  sessionId: string;
  brandName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Result[]>([]);
  const [loadingLine, setLoadingLine] = useState(LOADING_LINES[0]);

  async function generate() {
    if (loading) return;
    setError(null);
    setLoading(true);
    setLoadingLine(
      LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)],
    );

    try {
      const res = await fetch(`/api/ai-hearing/${sessionId}/test-post`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        tweet?: string;
        image_concept?: string;
        theme_summary?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (!body.tweet) {
        throw new Error("生成結果が空でした");
      }
      const next: Result = {
        tweet: body.tweet,
        image_concept: body.image_concept ?? null,
        theme_summary: body.theme_summary ?? null,
      };
      // Move current into history before replacing.
      if (result) setHistory((h) => [result, ...h].slice(0, 4));
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">🎬 試してみる</h2>
          <p className="mt-1 text-xs text-ink-muted">
            このAI設定で実際にどんな投稿が出るか試してみましょう。
            気に入らなければ何度でも生成できます。
          </p>
        </div>
        {!result && !loading && (
          <button type="button" onClick={generate} className="btn-primary">
            テスト投稿を生成する
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-3 rounded-xl border border-cyan/30 bg-cyan/5 p-5">
          <Spinner size={18} />
          <div>
            <div className="text-sm text-ink">{loadingLine}</div>
            <div className="mt-1 text-[11px] text-ink-subtle">
              通常 5〜15秒程度
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-5">
          <div className="text-sm font-bold text-ink">生成に失敗しました</div>
          <div className="text-xs text-ink-muted">{error}</div>
          <button type="button" onClick={generate} className="btn-secondary">
            もう一度試す
          </button>
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4">
          {result.theme_summary && (
            <div className="font-mono text-[11px] tracking-widest text-cyan">
              テーマ：{result.theme_summary}
            </div>
          )}
          <TweetPreview
            tweet={result.tweet}
            imageConcept={result.image_concept}
            brandName={brandName}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="btn-secondary"
            >
              🔄 もう一度生成
            </button>
            <span className="grid place-items-center text-[11px] text-ink-subtle">
              💰 1回あたり約2円
            </span>
          </div>

          {history.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-ink-muted hover:text-cyan">
                ▸ 過去の生成結果を見る ({history.length})
              </summary>
              <div className="mt-3 space-y-3 opacity-80">
                {history.map((h, i) => (
                  <div key={i} className="space-y-1.5">
                    {h.theme_summary && (
                      <div className="font-mono text-[10px] tracking-widest text-ink-subtle">
                        テーマ：{h.theme_summary}
                      </div>
                    )}
                    <TweetPreview
                      tweet={h.tweet}
                      imageConcept={h.image_concept}
                      brandName={brandName}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
