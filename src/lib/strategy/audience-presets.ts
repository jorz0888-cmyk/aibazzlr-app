export type AudiencePreset = {
  industry: string;
  label: string;
  description: string;
  age_range: string;
  gender: string;
  lifestyle_hints: string[];
  tone_guidance: string;
  emoji_density: "minimal" | "low" | "medium" | "high";
};

export const AUDIENCE_PRESETS: Record<string, AudiencePreset> = {
  restaurant_weekday_office_women_20s: {
    industry: "restaurant",
    label: "仕事終わりの20代女性",
    description: "オフィスワーカー、平日18-21時の利用が多い",
    age_range: "20-29",
    gender: "female",
    lifestyle_hints: [
      "仕事終わり",
      "友人と少人数",
      "インスタ映え重視",
      "コスパ感",
    ],
    tone_guidance: "カジュアル、絵文字多め、写真の魅力訴求",
    emoji_density: "high",
  },
  restaurant_family: {
    industry: "restaurant",
    label: "ファミリー層",
    description: "子連れ、休日の利用、お祝い事",
    age_range: "30-45",
    gender: "any",
    lifestyle_hints: ["子連れ", "記念日", "個室希望", "アレルギー対応"],
    tone_guidance: "安心感、丁寧、お子様歓迎の雰囲気",
    emoji_density: "medium",
  },
  restaurant_solo_drinker: {
    industry: "restaurant",
    label: "一人飲み・常連客",
    description: "カウンター席、平日夜、リピート率高",
    age_range: "30-55",
    gender: "male",
    lifestyle_hints: ["一人", "常連", "会話を楽しむ", "日本酒・焼酎好き"],
    tone_guidance: "落ち着いた、店主の言葉、こだわり訴求",
    emoji_density: "low",
  },
  restaurant_business: {
    industry: "restaurant",
    label: "ビジネスマン・接待",
    description: "個室、商談、おもてなし",
    age_range: "35-60",
    gender: "male",
    lifestyle_hints: ["接待", "個室", "静か", "会社払い"],
    tone_guidance: "フォーマル、品格、接待での使い方訴求",
    emoji_density: "minimal",
  },
  salon_office_women_20s: {
    industry: "salon",
    label: "20代OL",
    description: "会社帰り・休日の利用、トレンド重視",
    age_range: "20-29",
    gender: "female",
    lifestyle_hints: ["トレンド", "インスタ", "コスパ", "会社員"],
    tone_guidance: "明るい、おしゃれ、ビフォーアフター訴求",
    emoji_density: "high",
  },
  salon_housewife: {
    industry: "salon",
    label: "主婦層",
    description: "平日昼、子育て世代、リラックス重視",
    age_range: "30-45",
    gender: "female",
    lifestyle_hints: ["子育て", "短時間", "リラックス", "常連志向"],
    tone_guidance: "親しみ、丁寧、ママ目線",
    emoji_density: "medium",
  },
  spi_women_30s_40s: {
    industry: "spiritual",
    label: "30-40代女性、スピ好き",
    description: "人生の節目、感性重視",
    age_range: "30-49",
    gender: "female",
    lifestyle_hints: ["ヨガ", "パワーストーン", "感性", "心の整え"],
    tone_guidance: "静かに寄り添う、押し付けない、内省的",
    emoji_density: "minimal",
  },
  spi_love_concerns: {
    industry: "spiritual",
    label: "恋愛相談層",
    description: "恋愛・人間関係の悩み",
    age_range: "20-40",
    gender: "female",
    lifestyle_hints: ["恋愛", "人間関係", "将来の不安"],
    tone_guidance: "共感、希望を持たせる、押し付けない",
    emoji_density: "low",
  },
  pro_business_owner: {
    industry: "professional",
    label: "中小企業経営者",
    description: "B2B、信頼性重視",
    age_range: "40-60",
    gender: "any",
    lifestyle_hints: ["経営者", "実務的", "信頼性", "実績重視"],
    tone_guidance: "専門的、実例ベース、信頼性訴求",
    emoji_density: "minimal",
  },
  general: {
    industry: "any",
    label: "汎用（特定しない）",
    description: "幅広い層に届ける",
    age_range: "any",
    gender: "any",
    lifestyle_hints: [],
    tone_guidance: "万人向け、平易、押し付けない",
    emoji_density: "medium",
  },
};

export const AUDIENCE_PRESET_KEYS = Object.keys(AUDIENCE_PRESETS);

export function getAudiencePreset(
  key: string | null | undefined,
): AudiencePreset | null {
  if (!key) return null;
  return AUDIENCE_PRESETS[key] ?? null;
}

/**
 * Filter the catalogue for a single industry while always keeping the
 * "general" fallback. Industry strings on ai_configs are free-text so we
 * do best-effort substring matching.
 */
export function presetsForIndustry(industry: string | null): AudiencePreset[] {
  const all = Object.values(AUDIENCE_PRESETS);
  if (!industry) return all;
  const lower = industry.toLowerCase();
  const matched = all.filter((p) => {
    if (p.industry === "any") return true;
    if (p.industry === "restaurant") {
      return (
        lower.includes("飲食") ||
        lower.includes("カフェ") ||
        lower.includes("レストラン") ||
        lower.includes("バー") ||
        lower.includes("居酒屋") ||
        lower.includes("restaurant")
      );
    }
    if (p.industry === "salon") {
      return (
        lower.includes("美容") ||
        lower.includes("サロン") ||
        lower.includes("salon")
      );
    }
    if (p.industry === "spiritual") {
      return (
        lower.includes("占い") ||
        lower.includes("スピ") ||
        lower.includes("ヒーリング")
      );
    }
    if (p.industry === "professional") {
      return (
        lower.includes("士業") ||
        lower.includes("税理士") ||
        lower.includes("コンサル") ||
        lower.includes("行政書士")
      );
    }
    return false;
  });
  return matched.length > 0 ? matched : all;
}
