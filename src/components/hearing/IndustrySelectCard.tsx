"use client";

import type { AccountMode } from "@/lib/supabase/types";

export type IndustryOption = {
  key: string;
  label: string;
  description: string;
  emoji: string;
};

/** Industries shown when the user picks the "real business" mode. */
export const REAL_INDUSTRIES: IndustryOption[] = [
  {
    key: "cafe",
    label: "カフェ・飲食店",
    description: "メニュー・スタッフ・空間など、お店ならではの世界観を引き出します",
    emoji: "☕",
  },
  {
    key: "salon",
    label: "美容・サロン",
    description: "技術・カウンセリング・空気感の魅力を言語化します",
    emoji: "💇",
  },
  {
    key: "clinic",
    label: "クリニック・治療院",
    description: "専門性と親しみやすさのバランスを大事に表現します",
    emoji: "🩺",
  },
  {
    key: "shop",
    label: "ショップ・小売",
    description: "商品の背景や仕入れストーリーを丁寧に投稿します",
    emoji: "🛍️",
  },
  {
    key: "service",
    label: "サービス・士業",
    description: "信頼感のあるトーンで、専門知識を分かりやすく",
    emoji: "📋",
  },
  {
    key: "other",
    label: "その他・指定なし",
    description: "ヒアリングしながら最適な業種を判断します",
    emoji: "✨",
  },
];

/** Types shown when the user picks the "fictional persona" mode. */
export const FICTIONAL_TYPES: IndustryOption[] = [
  {
    key: "side_business",
    label: "副業発信・知識系",
    description: "金融・スキル・ビジネスの知識をシェアするキャラ",
    emoji: "💼",
  },
  {
    key: "expert",
    label: "専門家系",
    description: "コーチ・コンサル・占いなどの専門家ペルソナ",
    emoji: "🎯",
  },
  {
    key: "lifestyle",
    label: "ライフスタイル系",
    description: "哲学・気づき・思想を発信するキャラ",
    emoji: "✨",
  },
  {
    key: "learning",
    label: "学び系",
    description: "読書・心理学・自己啓発を発信するキャラ",
    emoji: "📚",
  },
  {
    key: "entertainment",
    label: "エンタメ・キャラ系",
    description: "オリジナルキャラクターやエンタメ系発信",
    emoji: "🎨",
  },
  {
    key: "other",
    label: "その他・指定なし",
    description: "ヒアリングしながら最適なタイプを判断します",
    emoji: "✨",
  },
];

/** Back-compat: existing imports continue to work (defaults to real list). */
export const INDUSTRY_OPTIONS = REAL_INDUSTRIES;

export function industriesFor(mode: AccountMode): IndustryOption[] {
  return mode === "fictional" ? FICTIONAL_TYPES : REAL_INDUSTRIES;
}

export function IndustrySelectCard({
  option,
  selected,
  onSelect,
  variant = "cyan",
}: {
  option: IndustryOption;
  selected: boolean;
  onSelect: () => void;
  variant?: "cyan" | "accent";
}) {
  const sel =
    variant === "accent"
      ? "border-accent/60 bg-accent/5"
      : "border-cyan/60 bg-cyan/5 shadow-cyan";
  const hover =
    variant === "accent"
      ? "hover:border-accent/30 hover:bg-white/[0.02]"
      : "hover:border-cyan/30 hover:bg-white/[0.02]";
  const badgeClass =
    variant === "accent"
      ? "bg-accent/20 text-accent"
      : "bg-cyan/20 text-cyan";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "card group flex w-full items-start gap-4 p-5 text-left transition",
        selected ? sel : hover,
      ].join(" ")}
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">
        {option.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-ink">{option.label}</h3>
          {selected && (
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] tracking-widest ${badgeClass}`}
            >
              SELECTED
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {option.description}
        </p>
      </div>
    </button>
  );
}
