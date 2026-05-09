import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAiConfigById } from "@/lib/db/ai-configs";
import { toStringArray } from "@/lib/ai/normalize-extracted";
import {
  EditableLines,
  EditableTags,
  EditableText,
  EditableTextarea,
} from "@/components/config/editable";
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

  // Defensive normalization: even if old rows still contain object entries,
  // toStringArray cleans them up before render.
  const must = toStringArray(config.must_include_elements);
  const ng = toStringArray(config.ng_words);
  const hashtags = toStringArray(config.hashtag_pool);
  const examples = toStringArray(config.good_examples);
  const menu = toStringArray(config.menu_items);
  const seasonal = toStringArray(config.seasonal_items);
  const episodes = toStringArray(config.real_episodes);
  const announcements = toStringArray(config.announcement_topics);

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
        <EditableText
          configId={config.id}
          field="name"
          initial={config.name}
          label="設定名"
        />
        <EditableText
          configId={config.id}
          field="business_name"
          initial={config.business_name}
          label="ビジネス名"
        />
        <EditableText
          configId={config.id}
          field="industry"
          initial={config.industry}
          label="業種"
        />
        <EditableText
          configId={config.id}
          field="persona_role"
          initial={config.persona_role}
          label="投稿者の役割"
          placeholder="店主 / スタッフ / オーナーなど"
        />
        <EditableText
          configId={config.id}
          field="target_audience"
          initial={config.target_audience}
          label="ターゲット読者"
        />
        <EditableText
          configId={config.id}
          field="voice_tone"
          initial={config.voice_tone}
          label="声のトーン"
          placeholder="casual_polite / friendly_polite など"
        />
        <EditableText
          configId={config.id}
          field="posting_frequency"
          initial={config.posting_frequency}
          label="投稿頻度"
        />
      </Card>

      {config.account_mode === "real" && (
        <Card title="🏪 実在情報（編集可能）">
          <EditableText
            configId={config.id}
            field="business_hours"
            initial={config.business_hours}
            label="営業時間"
            placeholder="11:30-14:00 / 17:30-22:00"
          />
          <EditableText
            configId={config.id}
            field="closed_days"
            initial={config.closed_days}
            label="定休日"
            placeholder="水曜日・第3木曜日"
          />
          <EditableText
            configId={config.id}
            field="address"
            initial={config.address}
            label="所在地"
            placeholder="東京都中野区中野5丁目"
          />
          <EditableText
            configId={config.id}
            field="price_range"
            initial={config.price_range}
            label="価格帯"
            placeholder="ランチ800-1200円 / ディナー2000-3500円"
          />

          <div className="mt-5 space-y-4 border-t border-line pt-5">
            <EditableTags
              configId={config.id}
              field="menu_items"
              initial={menu}
              label="看板メニュー"
              variant="cyan"
            />
            <EditableTags
              configId={config.id}
              field="seasonal_items"
              initial={seasonal}
              label="季節限定・日替わり"
              variant="cyan"
            />
            <EditableLines
              configId={config.id}
              field="real_episodes"
              initial={episodes}
              label="実話エピソード（許可済み）"
              placeholder="エピソードを1件入力..."
            />
            <EditableTags
              configId={config.id}
              field="announcement_topics"
              initial={announcements}
              label="告知テーマ"
              variant="muted"
            />
          </div>
        </Card>
      )}

      <Card title="世界観">
        <EditableTextarea
          configId={config.id}
          field="world_view"
          initial={config.world_view}
          label="世界観"
          rows={6}
        />
        <div className="mt-4">
          <EditableTextarea
            configId={config.id}
            field="business_description"
            initial={config.business_description}
            label="ブランド概要"
            rows={3}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="必須要素">
          <EditableTags
            configId={config.id}
            field="must_include_elements"
            initial={must}
            label=""
            variant="cyan"
            max={5}
          />
        </Card>

        <Card title="NGワード">
          <EditableTags
            configId={config.id}
            field="ng_words"
            initial={ng}
            label=""
            variant="danger"
            max={10}
          />
        </Card>
      </div>

      <Card title="良い投稿例">
        <EditableLines
          configId={config.id}
          field="good_examples"
          initial={examples}
          label=""
          placeholder="良い投稿例を入力..."
        />
      </Card>

      <Card title="ハッシュタグプール">
        <EditableTags
          configId={config.id}
          field="hashtag_pool"
          initial={hashtags}
          label=""
          variant="cyan"
          max={10}
        />
      </Card>

      <Card title="生成されたシステムプロンプト">
        <EditableTextarea
          configId={config.id}
          field="generated_system_prompt"
          initial={config.generated_system_prompt}
          label="システムプロンプト（手動編集可）"
          rows={20}
        />
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
