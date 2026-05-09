import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listAiConfigsByUser } from "@/lib/db/ai-configs";
import { listActivePromptTemplates } from "@/lib/db/prompt-templates";
import type { AiConfig, PromptTemplate } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch in parallel; isolate failures so one query crash doesn't take the
  // whole page down.
  const [configsRes, templatesRes] = await Promise.allSettled([
    listAiConfigsByUser(supabase, user.id),
    listActivePromptTemplates(supabase),
  ]);

  const configs: AiConfig[] =
    configsRes.status === "fulfilled" ? configsRes.value : [];
  const templates: PromptTemplate[] =
    templatesRes.status === "fulfilled" ? templatesRes.value : [];

  const errors: string[] = [];
  if (configsRes.status === "rejected") {
    errors.push(`AI設定の読み込みに失敗しました: ${describe(configsRes.reason)}`);
  }
  if (templatesRes.status === "rejected") {
    errors.push(
      `プリセットの読み込みに失敗しました: ${describe(templatesRes.reason)}`,
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── AI CONFIGURATION
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          AI設定
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          ブランドの世界観・トーン・NGワードを定義し、AIに学習させます。
        </p>
      </div>

      {errors.length > 0 && (
        <div className="err">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {/* My configs */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            自分の設定
          </h2>
          <Link href="/dashboard/settings/ai/new" className="btn-primary">
            + 新規作成
          </Link>
        </div>

        {configs.length === 0 ? (
          <EmptyConfig />
        ) : (
          <ul className="grid gap-3">
            {configs.map((c) => (
              <ConfigCard key={c.id} config={c} />
            ))}
          </ul>
        )}
      </section>

      {/* Industry presets */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          業種別プリセット
        </h2>
        <p className="-mt-2 text-xs text-ink-subtle">
          ベースとして利用できる業種テンプレート（読み取り専用）。
        </p>

        {templates.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-ink-muted">
            プリセットはまだ用意されていません。
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConfigCard({ config }: { config: AiConfig }) {
  // Defensive: array columns might be null if DB default not applied to existing rows.
  const hashtags = config.hashtag_pool ?? [];
  const ngWords = config.ng_words ?? [];
  const goodExamples = config.good_examples ?? [];

  const subtitleParts = [
    config.industry,
    config.business_name,
    config.voice_tone,
  ].filter(Boolean);

  return (
    <li className="card p-5 transition hover:border-cyan/30">
      <div className="flex items-start gap-3">
        <Link
          href={`/dashboard/settings/ai/${config.id}`}
          className="min-w-0 flex-1 group"
        >
          <div className="flex items-center gap-2">
            <ModeBadge mode={config.account_mode} />
            <h3 className="truncate text-base font-bold text-ink group-hover:text-cyan">
              {config.name}
            </h3>
            {config.is_default && (
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-cyan">
                DEFAULT
              </span>
            )}
            {config.status && (
              <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[9px] tracking-wider text-ink-muted">
                {config.status.toUpperCase()}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {subtitleParts.length > 0 ? subtitleParts.join(" · ") : "未設定"}
          </div>
        </Link>
        <div className="flex shrink-0 gap-1">
          <Link
            href={`/dashboard/settings/ai/${config.id}`}
            className="btn-ghost"
          >
            詳細
          </Link>
          <Link
            href={`/dashboard/settings/ai/${config.id}/edit`}
            className="btn-ghost"
          >
            編集
          </Link>
        </div>
      </div>

      {(config.world_view || config.business_description) && (
        <p className="mt-4 line-clamp-2 text-sm text-ink-muted">
          {config.world_view ?? config.business_description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {hashtags.slice(0, 6).map((h) => (
          <span
            key={h}
            className="rounded-full border border-cyan/25 bg-cyan/5 px-2 py-0.5 font-mono text-[10px] text-cyan"
          >
            {h.startsWith("#") ? h : `#${h}`}
          </span>
        ))}
        {ngWords.length > 0 && (
          <span className="rounded-full border border-danger/25 bg-danger/5 px-2 py-0.5 font-mono text-[10px] text-danger">
            NG: {ngWords.length}
          </span>
        )}
        {goodExamples.length > 0 && (
          <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
            良い例: {goodExamples.length}件
          </span>
        )}
        {config.requires_approval && (
          <span className="rounded-full border border-accent/25 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent">
            承認制
          </span>
        )}
      </div>
    </li>
  );
}

function ModeBadge({ mode }: { mode: AiConfig["account_mode"] | undefined }) {
  const m = mode === "fictional" ? "fictional" : "real";
  if (m === "real") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-cyan">
        🏪 実在
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-accent">
      🎭 架空
    </span>
  );
}

function TemplateCard({ template }: { template: PromptTemplate }) {
  const tone =
    template.default_voice_tone ?? template.default_persona_role ?? null;

  return (
    <li className="card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent">
          {template.industry.toUpperCase()}
        </span>
        <h3 className="truncate text-sm font-bold text-ink">{template.name}</h3>
      </div>
      {template.description && (
        <p className="mt-2 text-xs text-ink-muted">{template.description}</p>
      )}
      {tone && (
        <p className="mt-3 font-mono text-[11px] text-ink-subtle">
          tone: {tone}
        </p>
      )}
      <Link
        href={`/dashboard/settings/ai/new/hearing?industry=${encodeURIComponent(template.industry)}`}
        className="btn-secondary mt-4 w-full"
      >
        このプリセットから作成
      </Link>
    </li>
  );
}

function EmptyConfig() {
  return (
    <div className="card grid place-items-center px-6 py-12 text-center">
      <div className="text-3xl">🧠</div>
      <h3 className="mt-3 text-sm font-bold text-ink">
        AI設定がまだありません
      </h3>
      <p className="mt-1 max-w-sm text-xs text-ink-muted">
        ブランドの世界観や口調を登録すると、AIが「あなたらしい」投稿を生成できるようになります。
      </p>
      <Link href="/dashboard/settings/ai/new" className="btn-primary mt-5">
        最初のAI設定を作成
      </Link>
    </div>
  );
}

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const m = (reason as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "詳細不明のエラー";
}
