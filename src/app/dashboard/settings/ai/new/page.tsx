import Link from "next/link";

export default function NewAiConfigChoice() {
  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── NEW AI CONFIG
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          AI設定を作成
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          AIBazzlrのAI設定は、AIヒアリングで自動生成するか、手動で入力するかを選べます。
          初めての方はAIヒアリングがおすすめです。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Link
          href="/dashboard/settings/ai/new/hearing"
          className="card group relative overflow-hidden p-7 transition hover:border-cyan/50 hover:shadow-cyan"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 font-mono text-[10px] tracking-widest text-cyan">
            ⭐ おすすめ
          </div>
          <div className="text-3xl">🎙️</div>
          <h2 className="mt-3 text-lg font-bold text-ink">AIヒアリングで作成</h2>
          <p className="mt-2 text-sm text-ink-muted">
            10〜15分のチャット会話で、AIがお店の世界観・口調・必須要素を聞き出します。
            完了後はそのお店専用のシステムプロンプトが自動生成され、すぐに使えます。
          </p>
          <ul className="mt-4 space-y-1.5 text-xs text-ink-muted">
            <li>✓ 10問の質問に答えるだけ</li>
            <li>✓ 業界他社では絶対出ない品質の投稿</li>
            <li>✓ 編集・調整可能</li>
          </ul>
          <div className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-cyan group-hover:gap-2">
            ヒアリングを始める
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        <Link
          href="/dashboard/settings/ai/new/manual"
          className="card group p-7 transition hover:border-accent/50"
        >
          <div className="text-3xl">✏️</div>
          <h2 className="mt-3 text-lg font-bold text-ink">手動で入力</h2>
          <p className="mt-2 text-sm text-ink-muted">
            既にブランドガイドラインがある方や、ご自身で細かく調整したい方向け。
            すべての項目を直接入力します。
          </p>
          <ul className="mt-4 space-y-1.5 text-xs text-ink-muted">
            <li>✓ 全項目を細かく調整</li>
            <li>✓ 既存テンプレートからコピー可</li>
            <li>✓ 数分で完了</li>
          </ul>
          <div className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-accent group-hover:gap-2">
            フォームへ進む
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      </div>
    </div>
  );
}
