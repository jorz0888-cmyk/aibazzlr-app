import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { ConfigDetailActions } from "./ConfigDetailActions";

export const dynamic = "force-dynamic";

export default async function ConfigDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const config = await getAiConfigById(supabase, id);
  if (!config || config.user_id !== user.id) notFound();

  const must = config.must_include_elements ?? [];
  const ng = config.ng_words ?? [];
  const hashtags = config.hashtag_pool ?? [];
  const examples = config.good_examples ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/dashboard/settings/ai"
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-cyan"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            AI設定一覧へ戻る
          </Link>
          <h1 className="mt-3 flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight text-ink">
            {config.account_mode === "fictional" ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-accent">
                🎭 架空モード
              </span>
            ) : (
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-cyan">
                🏪 実在モード
              </span>
            )}
            {config.name}
            {config.is_default && (
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-cyan">
                DEFAULT
              </span>
            )}
            {config.status && (
              <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-widest text-ink-muted">
                {config.status.toUpperCase()}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {config.industry ?? "業種未設定"}
            {config.business_name && ` · ${config.business_name}`}
          </p>
        </div>

        <ConfigDetailActions
          configId={config.id}
          isDefault={config.is_default}
        />
      </div>

      <Card title="基本情報">
        <Row label="ビジネス名" value={config.business_name} />
        <Row label="業種" value={config.industry} />
        <Row label="投稿者の役割" value={config.persona_role} />
        <Row label="ターゲット読者" value={config.target_audience} />
        <Row label="声のトーン" value={config.voice_tone} />
        <Row label="投稿頻度" value={config.posting_frequency} />
        <Row
          label="承認モード"
          value={config.requires_approval ? "承認制" : "完全自動"}
        />
      </Card>

      {config.account_mode === "real" && (
        <Card title="実在情報（捏造禁止モード）">
          <Row label="営業時間" value={config.business_hours} />
          <Row label="定休日" value={config.closed_days} />
          <Row label="所在地" value={config.address} />
          <Row label="価格帯" value={config.price_range} />
          <Row
            label="看板メニュー"
            value={
              (config.menu_items?.length ?? 0) > 0
                ? config.menu_items.join(" / ")
                : null
            }
          />
          <Row
            label="季節限定"
            value={
              (config.seasonal_items?.length ?? 0) > 0
                ? config.seasonal_items.join(" / ")
                : null
            }
          />
          <Row
            label="実話エピソード"
            value={
              (config.real_episodes?.length ?? 0) > 0
                ? `${config.real_episodes.length}件登録`
                : null
            }
          />
          <Row
            label="告知テーマ"
            value={
              (config.announcement_topics?.length ?? 0) > 0
                ? config.announcement_topics.join(" / ")
                : null
            }
          />
        </Card>
      )}

      <Card title="世界観">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {config.world_view ?? "（未設定）"}
        </p>
        {config.business_description && (
          <p className="mt-3 text-xs text-ink-muted">
            概要: {config.business_description}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`必須要素（${must.length}）`}>
          {must.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1.5 text-sm text-ink">
              {must.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-[11px] text-cyan">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`NGワード（${ng.length}）`}>
          {ng.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ng.map((w, i) => (
                <span
                  key={i}
                  className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[11px] text-danger"
                >
                  {w}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={`良い投稿例（${examples.length}）`}>
        {examples.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-3">
            {examples.map((ex, i) => (
              <li
                key={i}
                className="rounded-lg border border-line bg-bg/40 p-4 text-sm leading-relaxed text-ink"
              >
                <span className="mr-2 font-mono text-[11px] text-ink-subtle">
                  #{i + 1}
                </span>
                <span className="whitespace-pre-wrap">{ex}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`ハッシュタグプール（${hashtags.length}）`}>
        {hashtags.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((h, i) => (
              <span
                key={i}
                className="rounded-full border border-cyan/30 bg-cyan/5 px-2 py-0.5 font-mono text-[11px] text-cyan"
              >
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card title="生成されたシステムプロンプト">
        {config.generated_system_prompt ? (
          <details className="group">
            <summary className="cursor-pointer text-sm text-cyan group-open:text-ink-muted">
              ▸ 全文を表示する
            </summary>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg/60 p-4 font-mono text-[12px] leading-relaxed text-ink-muted">
              {config.generated_system_prompt}
            </pre>
          </details>
        ) : (
          <Empty />
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 transition hover:border-cyan/20">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{value ?? "—"}</span>
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-ink-subtle">未登録</div>;
}
