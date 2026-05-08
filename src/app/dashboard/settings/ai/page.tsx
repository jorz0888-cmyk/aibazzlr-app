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

  const [configs, templates] = await Promise.all([
    listAiConfigsByUser(supabase, user.id),
    listActivePromptTemplates(supabase),
  ]);

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

      {/* My configs */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            自分の設定
          </h2>
          <button type="button" className="btn-primary" disabled>
            + 新規作成
          </button>
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
  return (
    <li className="card p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold text-ink">
              {config.name}
            </h3>
            {config.is_default && (
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-cyan">
                DEFAULT
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            {config.industry ?? "業種未設定"}
            {config.voice_tone && ` · ${config.voice_tone}`}
          </div>
        </div>
        <button type="button" className="btn-ghost shrink-0" disabled>
          編集
        </button>
      </div>

      {config.world_view && (
        <p className="mt-4 line-clamp-2 text-sm text-ink-muted">
          {config.world_view}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {config.hashtags.slice(0, 6).map((h) => (
          <span
            key={h}
            className="rounded-full border border-cyan/25 bg-cyan/5 px-2 py-0.5 font-mono text-[10px] text-cyan"
          >
            {h.startsWith("#") ? h : `#${h}`}
          </span>
        ))}
        {config.ng_words.length > 0 && (
          <span className="rounded-full border border-danger/25 bg-danger/5 px-2 py-0.5 font-mono text-[10px] text-danger">
            NG: {config.ng_words.length}
          </span>
        )}
        {config.good_examples.length > 0 && (
          <span className="rounded-full border border-line-strong bg-white/5 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
            良い例: {config.good_examples.length}件
          </span>
        )}
      </div>
    </li>
  );
}

function TemplateCard({ template }: { template: PromptTemplate }) {
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
      {template.default_voice_tone && (
        <p className="mt-3 font-mono text-[11px] text-ink-subtle">
          tone: {template.default_voice_tone}
        </p>
      )}
      <button type="button" className="btn-secondary mt-4 w-full" disabled>
        このプリセットから作成
      </button>
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
      <button type="button" className="btn-primary mt-5" disabled>
        最初のAI設定を作成
      </button>
    </div>
  );
}
