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

// 2026-05-24 #E: month defaults rewritten to remove固有イベント名
// (新年/節分/立春/卒業/年度末/桜/入学/入社/GW明け/七夕/夏休み入り/
// お盆/残暑/紅葉/ハロウィン/クリスマス/年末). These were getting
// stuck deep into the month — e.g. May default kept saying
// "GW明け" all the way through 5/31 even though GW ended 5/5.
// Each default is now pure season / weather / nature language that
// stays valid the entire month it covers.
//
// NOTABLE_WINDOWS (specific date windows like the GW or クリスマス
// hints) are unchanged — when an event window matches, that
// window's hint wins; the month default only fires for days
// OUTSIDE every notable window.
const MONTH_DEFAULTS: Record<number, string> = {
  1: "厳寒・空気の透明感が増す時期。乾いた日中と冷えた朝晩",
  2: "厳寒のピーク。日は少しずつ伸び、店先には春の予感が混じる",
  3: "早春・寒暖差。日中の陽気と朝晩の冷えが混在する",
  4: "春本番・気温が安定して上がる時期。屋外の心地よさが戻る",
  5: "若葉・初夏の入り口・気温上昇期。日中は汗ばむ日も増える",
  6: "梅雨・じめじめ。傘とアイスの両立、室内消費が伸びる",
  7: "本格的な夏・湿度の高い日中と夕方の涼風",
  8: "盛夏・夜まで蒸す日が続き、冷たいメニューへの関心が高い",
  9: "初秋・夕方の風が涼しくなり、秋めく食材が出始める",
  10: "秋本番・乾いた空気・気温差で体調を崩しやすい",
  11: "晩秋・冷え込み。鍋・温かい飲み物が嬉しくなる",
  12: "師走・寒さ深まる・屋内が暖かく感じる時期",
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

/**
 * 2026-05-24 #E follow-up: "stale event" suppression list.
 *
 * Even with the positive hint sanitized, the LLM keeps writing
 * stale May tropes ("GW明け", "新生活") on 5/24 because its training
 * data heavily associates May with those keywords. The earlier #E
 * fix scrubbed the hint output but did nothing to actively warn the
 * LLM away from those words. This adds a NEGATIVE list:
 *
 *   "these words were fresh recently and are now expired —
 *    do not use them in this post"
 *
 * Each entry has a [from, until] (MM, DD) freshness window. An entry
 * is returned as "stale" when:
 *   - today is past the window's `until`, AND
 *   - today is within DECAY_DAYS days after `until`
 *
 * After DECAY_DAYS the event is so far in the past that no LLM
 * would invoke it anyway (no point spending prompt tokens telling
 * Anthropic to avoid 七夕 in November). Year-crossing windows
 * (年越し: 12/28→1/3) are handled by checking both branches.
 */
type SeasonalEvent = {
  keyword: string;
  /** [month, day] inclusive. */
  from: [number, number];
  /** [month, day] inclusive. */
  until: [number, number];
};

const SEASONAL_EVENTS: SeasonalEvent[] = [
  // 1月
  { keyword: "新年", from: [1, 1], until: [1, 10] },
  { keyword: "三が日", from: [1, 1], until: [1, 3] },
  { keyword: "初詣", from: [1, 1], until: [1, 7] },
  { keyword: "年始の挨拶", from: [1, 4], until: [1, 15] },
  // 2月
  { keyword: "節分", from: [1, 25], until: [2, 5] },
  { keyword: "立春", from: [1, 30], until: [2, 10] },
  { keyword: "バレンタイン", from: [2, 1], until: [2, 16] },
  // 3月
  { keyword: "ひな祭り", from: [2, 25], until: [3, 5] },
  { keyword: "ホワイトデー", from: [3, 8], until: [3, 16] },
  { keyword: "卒業", from: [3, 1], until: [3, 31] },
  { keyword: "年度末", from: [3, 15], until: [4, 5] },
  // 3-4月
  { keyword: "桜", from: [3, 20], until: [4, 15] },
  { keyword: "花見", from: [3, 20], until: [4, 15] },
  { keyword: "入学", from: [3, 25], until: [4, 15] },
  { keyword: "入社", from: [3, 25], until: [4, 15] },
  { keyword: "新生活", from: [3, 20], until: [4, 30] },
  // 4-5月
  { keyword: "GW", from: [4, 25], until: [5, 10] },
  { keyword: "ゴールデンウィーク", from: [4, 25], until: [5, 10] },
  { keyword: "連休", from: [4, 25], until: [5, 8] },
  { keyword: "GW明け", from: [5, 6], until: [5, 15] },
  { keyword: "五月病", from: [5, 6], until: [5, 25] },
  { keyword: "母の日", from: [5, 1], until: [5, 14] },
  // 6月
  { keyword: "梅雨入り", from: [5, 25], until: [6, 30] },
  { keyword: "梅雨", from: [6, 1], until: [7, 15] },
  { keyword: "父の日", from: [6, 1], until: [6, 18] },
  // 7月
  { keyword: "七夕", from: [6, 25], until: [7, 8] },
  { keyword: "梅雨明け", from: [7, 15], until: [8, 5] },
  { keyword: "夏休み", from: [7, 15], until: [8, 31] },
  // 8月
  { keyword: "お盆", from: [8, 10], until: [8, 17] },
  { keyword: "盛夏", from: [7, 20], until: [8, 20] },
  { keyword: "残暑", from: [8, 25], until: [9, 20] },
  // 9月
  { keyword: "敬老の日", from: [9, 1], until: [9, 22] },
  { keyword: "シルバーウィーク", from: [9, 15], until: [9, 25] },
  { keyword: "秋分", from: [9, 20], until: [9, 25] },
  // 10月
  { keyword: "紅葉", from: [10, 15], until: [12, 5] },
  { keyword: "ハロウィン", from: [10, 20], until: [10, 31] },
  // 11月
  { keyword: "文化の日", from: [10, 28], until: [11, 5] },
  { keyword: "勤労感謝", from: [11, 18], until: [11, 25] },
  // 12月
  { keyword: "クリスマス", from: [12, 10], until: [12, 26] },
  { keyword: "忘年会", from: [11, 25], until: [12, 31] },
  { keyword: "年末", from: [12, 20], until: [12, 31] },
  { keyword: "大晦日", from: [12, 28], until: [12, 31] },
];

/**
 * Return event keywords whose freshness window does NOT include today.
 *
 * Per the spec ("春以外の『新生活』、12月以外の『クリスマス』、晩夏
 * 以外の『残暑』"), the suppression list must hold for the ENTIRE
 * off-season, not just the few weeks after a window closes — the
 * LLM would otherwise write "新生活" in autumn from training-data
 * muscle memory. An earlier draft with a 35-day decay missed this.
 *
 * Currently in-window events are NOT returned — the positive hint
 * already covers them, and suppressing an active event would be wrong.
 *
 * Result: typically ~30-40 keywords on any given day. Cheap prompt
 * tokens for very high suppression coverage.
 */
export function getStaleEvents(date: Date = new Date()): string[] {
  const today = jstYMD(date);
  const stale: string[] = [];
  for (const ev of SEASONAL_EVENTS) {
    const active = inWindow(today.m, today.d, {
      fromMonth: ev.from[0],
      fromDay: ev.from[1],
      toMonth: ev.until[0],
      toDay: ev.until[1],
      hint: "",
    });
    if (!active) stale.push(ev.keyword);
  }
  return stale;
}
