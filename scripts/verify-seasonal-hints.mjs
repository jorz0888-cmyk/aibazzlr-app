// 2026-05-24 #E verification: spot-check getSeasonalHint across
// 12+ dates and assert no proper-noun event names leak through.
// Reads the source as text and ports it inline so we can run with
// plain node (no tsx / ts-node required).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, "..", "src", "lib", "posts", "seasonal.ts"),
  "utf8",
);

// Extract MONTH_DEFAULTS and NOTABLE_WINDOWS by eval'ing the
// relevant fragments. seasonal.ts is pure-data + a small pure
// function so this is safe for verification.
const monthMatch = src.match(/MONTH_DEFAULTS[^=]*=\s*({[\s\S]*?});/);
const winMatch = src.match(/NOTABLE_WINDOWS[^=]*=\s*(\[[\s\S]*?\]);/);
if (!monthMatch || !winMatch) {
  console.error("could not extract seasonal data");
  process.exit(1);
}
const MONTH_DEFAULTS = (0, eval)("(" + monthMatch[1] + ")");
const NOTABLE_WINDOWS = (0, eval)("(" + winMatch[1] + ")");

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
function getSeasonalHint(date) {
  const { m, d } = jstYMD(date);
  for (const w of NOTABLE_WINDOWS) {
    if (inWindow(m, d, w)) return { hint: w.hint, source: "window" };
  }
  return { hint: MONTH_DEFAULTS[m] ?? "", source: "month_default" };
}

// Test dates: each month's 中旬+下旬 (where month defaults usually
// fire), plus one date inside a NOTABLE_WINDOW for contrast.
const tests = [
  ["2026-01-15", "1月中旬 (default)"],
  ["2026-01-25", "1月下旬 (default)"],
  ["2026-02-20", "2月下旬 (default)"],
  ["2026-03-12", "3月中旬 (default)"],
  ["2026-03-25", "3月下旬 (default, just past 桜 window start)"],
  ["2026-04-20", "4月下旬 (default)"],
  ["2026-05-03", "5月上旬 (GW window, expect 'ゴールデンウィーク')"],
  ["2026-05-10", "5月上旬 (default, was 'GW明け')"],
  ["2026-05-24", "5月下旬 (default, was 'GW明け')"],
  ["2026-06-15", "6月中旬 (default)"],
  ["2026-07-15", "7月中旬 (default, brief gap between 七夕 and 夏休み windows)"],
  ["2026-09-15", "9月中旬 (default, was '残暑')"],
  ["2026-09-25", "9月下旬 (default, was '残暑')"],
  ["2026-10-10", "10月上旬 (default, was '紅葉/ハロウィン')"],
  ["2026-11-15", "11月中旬 (default)"],
  ["2026-12-15", "12月中旬 (default, was 'クリスマス/年末')"],
  ["2026-12-23", "12月クリスマス窓 (expect 'クリスマス')"],
];

// Forbidden proper-noun event names that must NOT appear in any
// month_default output (NOTABLE_WINDOW output is allowed to use
// them — those are time-bounded by design).
const FORBIDDEN_IN_DEFAULT = [
  "新年",
  "年始",
  "節分",
  "立春",
  "卒業",
  "年度末",
  "桜",
  "入学",
  "入社",
  "GW",
  "ゴールデンウィーク",
  "七夕",
  "夏休み",
  "お盆",
  "残暑",
  "紅葉",
  "ハロウィン",
  "クリスマス",
  "年末",
  "大晦日",
];

let bad = 0;
console.log(
  "date         source         hint" +
    " ".repeat(46) +
    "verdict",
);
console.log("─".repeat(110));
for (const [iso, label] of tests) {
  const { hint, source } = getSeasonalHint(new Date(iso + "T00:00:00Z"));
  let verdict = "✓";
  if (source === "month_default") {
    const hits = FORBIDDEN_IN_DEFAULT.filter((w) => hint.includes(w));
    if (hits.length > 0) {
      verdict = "✗ LEAK: " + hits.join(", ");
      bad++;
    }
  }
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(
    pad(iso, 13) +
      pad(source, 15) +
      pad(hint, 49) +
      " " +
      verdict +
      "   [" +
      label +
      "]",
  );
}
console.log("─".repeat(110));
console.log(`${bad === 0 ? "✓ ALL PASS" : `✗ ${bad} LEAKS`}`);
process.exit(bad === 0 ? 0 : 1);
