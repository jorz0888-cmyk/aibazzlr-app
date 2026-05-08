"use client";

export type IndustryOption = {
  key: string;
  label: string;
  description: string;
  emoji: string;
};

export const INDUSTRY_OPTIONS: IndustryOption[] = [
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

export function IndustrySelectCard({
  option,
  selected,
  onSelect,
}: {
  option: IndustryOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "card group flex w-full items-start gap-4 p-5 text-left transition",
        selected
          ? "border-cyan/60 bg-cyan/5 shadow-cyan"
          : "hover:border-cyan/30 hover:bg-white/[0.02]",
      ].join(" ")}
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">
        {option.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-ink">{option.label}</h3>
          {selected && (
            <span className="rounded-full bg-cyan/20 px-2 py-0.5 font-mono text-[9px] tracking-widest text-cyan">
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
