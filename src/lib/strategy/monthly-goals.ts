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
      "お店の特徴・こだわり",
      "はじめての方への案内",
      "雰囲気の伝わる写真",
      "アクセス情報",
    ],
    tone_modifier: "初めての人にも分かりやすく、敷居を下げる",
  },
  returning_customers: {
    label: "リピーターを増やしたい",
    description: "既存客の再来店を促す投稿",
    optimal_times: ["18:00", "21:00"],
    posting_frequency_per_week: 4,
    cta_preferences: ["line_official", "point_card", "next_visit_promo"],
    content_themes: [
      "新メニュー・限定メニュー",
      "常連様への感謝",
      "季節の変化",
      "スタッフの近況",
    ],
    tone_modifier: "「またあの店行こう」と思わせる、温かい関係性",
  },
  weekday_visits: {
    label: "平日の来店を増やしたい",
    description: "月〜木の集客を強化",
    optimal_times: ["11:30", "17:30"],
    posting_frequency_per_week: 6,
    cta_preferences: ["weekday_promo", "reservation_link"],
    content_themes: [
      "平日限定のお得情報",
      "仕事終わりの過ごし方",
      "平日ならではの静かな雰囲気",
      "平日限定メニュー",
    ],
    tone_modifier: "平日に行く価値を訴求、混雑回避のメリットも",
    target_days: ["mon", "tue", "wed", "thu"],
  },
  higher_spend: {
    label: "客単価を上げたい",
    description: "コースやプラスメニューの訴求",
    optimal_times: ["11:00", "17:00"],
    posting_frequency_per_week: 4,
    cta_preferences: ["course_menu", "reservation_link"],
    content_themes: [
      "コース・セットメニューの魅力",
      "特別な日の使い方",
      "ペアリング・組み合わせ提案",
      "プレミアム商品の紹介",
    ],
    tone_modifier: "価値訴求、お得感より特別感",
  },
  brand_awareness: {
    label: "認知度を上げたい",
    description: "バズ・拡散を狙う投稿",
    optimal_times: ["7:30", "12:00", "21:00"],
    posting_frequency_per_week: 7,
    cta_preferences: ["hashtag_focus", "share_invitation"],
    content_themes: [
      "インパクトのあるビジュアル",
      "裏話・舞台裏",
      "業界あるある",
      "地域情報",
    ],
    tone_modifier: "シェアされたくなる、語りたくなる切り口",
  },
  follower_growth: {
    label: "フォロワーを増やしたい",
    description: "エンゲージメント重視",
    optimal_times: ["7:00", "19:00"],
    posting_frequency_per_week: 7,
    cta_preferences: ["question_post", "poll"],
    content_themes: [
      "質問形式（コメント誘発）",
      "価値ある情報・ノウハウ",
      "シリーズもの・続きが気になる投稿",
      "プロフィール訴求",
    ],
    tone_modifier: "フォローする理由を作る、続きが気になる",
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
