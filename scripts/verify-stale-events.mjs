// 2026-05-24 #E follow-up verification. Per the spec ("春以外の
// 新生活, 12月以外のクリスマス"), an event is "stale" whenever
// today is NOT in its freshness window. Result is typically 30+
// keywords on any given date — verifying:
//   1. specific keywords the user complained about ARE suppressed
//      on the right dates
//   2. specific in-season keywords are NOT suppressed
//   3. list size is reasonable (won't blow up the prompt)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, "..", "src", "lib", "posts", "seasonal.ts"),
  "utf8",
);

const eventMatch = src.match(
  /SEASONAL_EVENTS: SeasonalEvent\[\] = (\[[\s\S]*?\]);/,
);
if (!eventMatch) {
  console.error("could not extract SEASONAL_EVENTS");
  process.exit(1);
}
const SEASONAL_EVENTS = (0, eval)("(" + eventMatch[1] + ")");

function jstYMD(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
  };
}
function inWindow(m, d, w) {
  const target = m * 100 + d;
  const start = w.fromMonth * 100 + w.fromDay;
  const end = w.toMonth * 100 + w.toDay;
  return target >= start && target <= end;
}
function getStaleEvents(date) {
  const today = jstYMD(date);
  return SEASONAL_EVENTS.filter(
    (ev) =>
      !inWindow(today.m, today.d, {
        fromMonth: ev.from[0],
        fromDay: ev.from[1],
        toMonth: ev.until[0],
        toDay: ev.until[1],
      }),
  ).map((ev) => ev.keyword);
}

const tests = [
  // [date, must_include, must_exclude, label]
  [
    "2026-05-24",
    ["GW明け", "新生活", "GW", "ゴールデンウィーク", "母の日", "クリスマス", "七夕"],
    [],
    "5月下旬: 全 off-season を suppress (user's original bug case)",
  ],
  [
    "2026-05-03",
    ["新生活", "桜", "クリスマス", "七夕"],
    ["GW", "ゴールデンウィーク", "連休"],
    "5月上旬 (GW期間中): GW系は active なので除外",
  ],
  [
    "2026-12-23",
    ["GW", "新生活", "桜", "七夕"],
    ["クリスマス", "忘年会", "年末"],
    "12月クリスマス期間中: 12月の active 語は除外",
  ],
  [
    "2026-09-25",
    ["新生活", "GW", "七夕", "クリスマス", "残暑"],
    [],
    "9月下旬: 残暑 until=9/20 → 9/25 で off-season → 含まれる",
  ],
  [
    "2026-04-22",
    ["クリスマス", "節分", "七夕", "桜", "入学", "GW"],
    ["新生活"],
    "4月下旬: 桜/入学(まで4/15) は終わって stale, 新生活(3/20-4/30) はまだ active",
  ],
];

let failed = 0;
for (const [iso, mustInclude, mustExclude, label] of tests) {
  const stale = getStaleEvents(new Date(iso + "T00:00:00Z"));
  const missing = mustInclude.filter((k) => !stale.includes(k));
  const leaked = mustExclude.filter((k) => stale.includes(k));
  const ok = missing.length === 0 && leaked.length === 0;
  if (!ok) failed++;
  console.log(
    `\n${iso}  ${ok ? "✓" : "✗"}  stale_count=${stale.length}  ${label}`,
  );
  console.log(`  stale: ${stale.join(", ")}`);
  if (missing.length) console.log(`  MISSING: ${missing.join(", ")}`);
  if (leaked.length) console.log(`  LEAKED: ${leaked.join(", ")}`);
}

console.log(`\n${failed === 0 ? "✓ ALL PASS" : `✗ ${failed} FAIL`}`);
process.exit(failed === 0 ? 0 : 1);
