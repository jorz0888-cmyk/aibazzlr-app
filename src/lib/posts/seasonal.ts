/**
 * Phase 17: lightweight Japanese seasonal context.
 *
 * Given a date, returns a short JP phrase that places the post in the
 * current cultural moment (お正月 / 花見 / 残暑 / 紅葉 / クリスマス /
 * etc.). The generator adds it to the prompt as "ゆるい季節背景" — the
 * model can lean in or ignore depending on whether it makes sense for
 * the chosen pillar.
 *
 * Pure function with no I/O. Defaults to the month label if no notable
 * window matches, so the return value is always non-empty.
 *
 * Date math is done in JST (UTC+9) because schedules + cron evaluate
 * in JST and we want "今日は12月25日" to mean what a JP user thinks it
 * means at 23:30 JST on the 25th, not "26日" because the server happens
 * to be UTC.
 */

const MONTH_DEFAULTS: Record<number, string> = {
  1: "新年・初春。空気は冷たく、店先にも年始の余韻がある時期",
  2: "厳寒・節分・立春前後。寒さのピークだが少しずつ日が伸びる",
  3: "早春・卒業/年度末。日中の陽気と朝晩の冷えが混在する",
  4: "新生活・桜・入学/入社。新しい客層に出会う季節",
  5: "GW明け・若葉・初夏の手前。日中は汗ばむ日も",
  6: "梅雨・じめじめ。傘とアイスの両立、室内消費が伸びる",
  7: "本格的な夏・七夕・夏休み入り。日中の暑さと夕方の涼風",
  8: "盛夏・お盆・残暑。夜まで蒸す日、冷たいメニューへの関心が高い",
  9: "残暑→初秋。夕方から虫の声、秋めく食材が出始める",
  10: "秋本番・紅葉・ハロウィン。気温差で体調を崩しやすい",
  11: "晩秋・冷え込み。鍋・温かい飲み物が嬉しくなる",
  12: "師走・クリスマス・年末。慌ただしさと年越し準備",
};

type Window = {
  /** Inclusive: matches if (month,day) >= (fromMonth,fromDay). */
  fromMonth: number;
  fromDay: number;
  /** Inclusive: matches if (month,day) <= (toMonth,toDay). */
  toMonth: number;
  toDay: number;
  hint: string;
};

/**
 * Notable windows checked BEFORE the month default. Ordered most-
 * specific first so e.g. 大晦日 wins over generic 師走. Only short
 * culturally-resonant moments — broader seasonal flavor is in
 * MONTH_DEFAULTS.
 */
const NOTABLE_WINDOWS: Window[] = [
  { fromMonth: 1, fromDay: 1, toMonth: 1, toDay: 3, hint: "三が日。初詣・おせち・年始の挨拶ムード" },
  { fromMonth: 1, fromDay: 4, toMonth: 1, toDay: 7, hint: "松の内・仕事始め。新年の決意が新鮮な時期" },
  { fromMonth: 2, fromDay: 2, toMonth: 2, toDay: 3, hint: "節分。豆まき・恵方巻・厄落とし" },
  { fromMonth: 2, fromDay: 14, toMonth: 2, toDay: 14, hint: "バレンタイン" },
  { fromMonth: 3, fromDay: 3, toMonth: 3, toDay: 3, hint: "ひな祭り" },
  { fromMonth: 3, fromDay: 14, toMonth: 3, toDay: 14, hint: "ホワイトデー" },
  { fromMonth: 3, fromDay: 20, toMonth: 4, toDay: 10, hint: "桜・花見シーズン。屋外飲食が増える一年の数少ない機会" },
  { fromMonth: 4, fromDay: 29, toMonth: 5, toDay: 5, hint: "ゴールデンウィーク。観光・帰省・連休消費" },
  { fromMonth: 6, fromDay: 1, toMonth: 6, toDay: 30, hint: "梅雨。傘・室内・しっとりした空気" },
  { fromMonth: 7, fromDay: 1, toMonth: 7, toDay: 7, hint: "七夕。短冊と笹の彩り" },
  { fromMonth: 7, fromDay: 20, toMonth: 8, toDay: 31, hint: "夏休み・お盆。家族連れや帰省客が増える期間" },
  { fromMonth: 9, fromDay: 1, toMonth: 9, toDay: 10, hint: "残暑。夏疲れの体に染みる涼やかなもの" },
  { fromMonth: 10, fromDay: 25, toMonth: 10, toDay: 31, hint: "ハロウィンウィーク。仮装・かぼちゃ・夜のお出かけ" },
  { fromMonth: 11, fromDay: 1, toMonth: 11, toDay: 30, hint: "紅葉・行楽。少し背伸びした外出が増える時期" },
  { fromMonth: 12, fromDay: 22, toMonth: 12, toDay: 25, hint: "クリスマス。プレゼント・ご褒美・特別感" },
  { fromMonth: 12, fromDay: 28, toMonth: 12, toDay: 31, hint: "年末・大晦日。一年の締めくくり、慌ただしさと感謝" },
];

function jstYMD(date: Date): { y: number; m: number; d: number } {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
  };
}

function inWindow(
  m: number,
  d: number,
  w: Window,
): boolean {
  // Treat MMDD as a single comparable integer to handle windows that
  // don't cross year boundaries (all current ones don't).
  const target = m * 100 + d;
  const start = w.fromMonth * 100 + w.fromDay;
  const end = w.toMonth * 100 + w.toDay;
  return target >= start && target <= end;
}

export function getSeasonalHint(date: Date = new Date()): string {
  const { m, d } = jstYMD(date);
  for (const w of NOTABLE_WINDOWS) {
    if (inWindow(m, d, w)) return w.hint;
  }
  return MONTH_DEFAULTS[m] ?? "";
}
