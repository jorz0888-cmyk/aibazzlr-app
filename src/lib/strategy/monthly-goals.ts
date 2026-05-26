import type { MonthlyGoalKey } from "@/lib/supabase/types";

export type MonthlyGoal = {
  label: string;
  description: string;
  optimal_times: string[];
  posting_frequency_per_week: number;
  cta_preferences: string[];
  content_themes: string[];
  tone_modifier: string;
  target_days?: string[];
};

export const MONTHLY_GOALS: Record<MonthlyGoalKey, MonthlyGoal> = {
  new_customers: {
    label: "新規客を増やしたい",
    description: "初めての方に届く投稿で認知拡大",
    optimal_times: ["12:00", "20:00"],
    posting_frequency_per_week: 5,
    cta_preferences: ["google_map", "menu_link", "first_time_promo"],
    content_themes: [
      "お店の特徴・こだわりの具体的な事実",
      "はじめての方への具体的な案内（席数・予約方法・所要時間など）",
      "実際の店内・席・道具の様子（事実のみ）",
      "アクセス情報（駅から徒歩何分・目印など事実）",
    ],
    tone_modifier:
      "初めての人にも分かりやすく、具体的な事実だけで敷居を下げる。脚色や雰囲気作りで補わない",
  },
  returning_customers: {
    label: "リピーターを増やしたい",
    description: "既存客の再来店を促す投稿",
    optimal_times: ["18:00", "21:00"],
    posting_frequency_per_week: 4,
    cta_preferences: ["line_official", "point_card", "next_visit_promo"],
    content_themes: [
      "新メニュー・限定メニューの具体（名前・価格・内容）",
      "提供しているサービスの実情報",
      "季節限定メニューの具体的な変更点",
      "営業時間や席数・運営の事実",
    ],
    tone_modifier:
      "再来店の具体的な理由を一つ、事実として示す。情緒的な言い回しで埋めない",
  },
  weekday_visits: {
    label: "平日の来店を増やしたい",
    description: "月〜木の集客を強化",
    optimal_times: ["11:30", "17:30"],
    posting_frequency_per_week: 6,
    cta_preferences: ["weekday_promo", "reservation_link"],
    content_themes: [
      "平日限定の具体的な価格・時間帯",
      "平日の混雑の事実（席の埋まり方・予約状況など）",
      "平日限定メニュー（名前・価格・内容）",
      "提供時間や席数など平日運営の事実",
    ],
    tone_modifier:
      "平日来店の具体的なメリット（価格・混雑・限定メニュー等）を事実として一つ示す",
    target_days: ["mon", "tue", "wed", "thu"],
  },
  higher_spend: {
    label: "客単価を上げたい",
    description: "コースやプラスメニューの訴求",
    optimal_times: ["11:00", "17:00"],
    posting_frequency_per_week: 4,
    cta_preferences: ["course_menu", "reservation_link"],
    content_themes: [
      "コース・セットメニューの実内容と価格",
      "用途の具体例（事実ベース）",
      "メニューの組み合わせの実提案",
      "プレミアム商品の名前・価格・内容",
    ],
    tone_modifier:
      "実内容と価格を具体的に示し、選ぶ理由を一つ事実として提示する。脚色しない",
  },
  brand_awareness: {
    label: "認知度を上げたい",
    description: "実物・現場の事実を届ける投稿で認知を広げる",
    optimal_times: ["7:30", "12:00", "21:00"],
    posting_frequency_per_week: 7,
    cta_preferences: ["hashtag_focus", "share_invitation"],
    content_themes: [
      "現場の具体的な様子（実物・道具・工程の事実）",
      "提供メニュー・商品の事実（名前・価格・特徴）",
      "業務上の客観的な事実・データ",
      "地元・地域の具体的な情報",
    ],
    tone_modifier:
      "具体的な事実を一つはっきり書く。エッセイ・物語化・脚色・「語りたくなる切り口」は避ける",
  },
  follower_growth: {
    label: "フォロワーを増やしたい",
    description: "事実ベースの情報提供でフォロワーを増やす",
    optimal_times: ["7:00", "19:00"],
    posting_frequency_per_week: 7,
    cta_preferences: ["question_post", "poll"],
    content_themes: [
      "実情報に基づく質問形式（実材料から1つ）",
      "具体的な手順・コツ（事実）",
      "連続性のある事実紹介",
      "プロフィール上の事実訴求",
    ],
    tone_modifier:
      "毎回1つの具体的な事実を提供する。続きをにおわせる演出や物語化はしない",
  },
};

export function getMonthlyGoal(key: string | null | undefined): MonthlyGoal | null {
  if (!key) return null;
  return (MONTHLY_GOALS as Record<string, MonthlyGoal>)[key] ?? null;
}

export const MONTHLY_GOAL_KEYS: MonthlyGoalKey[] = [
  "new_customers",
  "returning_customers",
  "weekday_visits",
  "higher_spend",
  "brand_awareness",
  "follower_growth",
];
