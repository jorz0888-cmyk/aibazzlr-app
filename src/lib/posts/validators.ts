/**
 * Detect foreign-language characters that have no business showing up in a
 * Japanese SNS post. We deliberately *do not* flag CJK Unified Ideographs
 * (Chinese-vs-Japanese-kanji overlap would cause false positives) or full-
 * width katakana / hiragana / standard punctuation.
 */
export type DetectedKind =
  | "korean"
  | "halfwidth_kana"
  | "box_drawing"
  | "ipa";

export type DetectedRun = {
  kind: DetectedKind;
  chars: string[];
};

export type ValidationResult = {
  valid: boolean;
  detected: DetectedRun[];
};

const CHECKS: Array<{ kind: DetectedKind; pattern: RegExp; label: string }> = [
  {
    kind: "korean",
    label: "ハングル",
    // Hangul syllables + Jamo blocks.
    pattern: /[가-힯ᄀ-ᇿ㄰-㆏]/g,
  },
  {
    kind: "halfwidth_kana",
    label: "半角カナ",
    // Half-width katakana letters only (U+FF66-U+FF9D). Half-width
    // punctuation marks (｡｢｣､) at U+FF61-U+FF65 are tolerated.
    pattern: /[ｦ-ﾝ]/g,
  },
  {
    kind: "box_drawing",
    label: "罫線",
    pattern: /[─-╿]/g,
  },
  {
    kind: "ipa",
    label: "IPA / 音声記号",
    pattern: /[ɐ-ʯ]/g,
  },
];

export function validateJapaneseOutput(text: string): ValidationResult {
  const detected: DetectedRun[] = [];
  for (const c of CHECKS) {
    const hits = text.match(c.pattern);
    if (hits && hits.length > 0) {
      detected.push({ kind: c.kind, chars: Array.from(new Set(hits)) });
    }
  }
  return { valid: detected.length === 0, detected };
}

export function describeDetected(detected: DetectedRun[]): string {
  return detected
    .map((d) => {
      const label =
        CHECKS.find((c) => c.kind === d.kind)?.label ?? d.kind;
      return `${label} (${d.chars.join("")})`;
    })
    .join(" / ");
}

/**
 * Human-friendly retry instruction appended to the user prompt when the
 * previous generation tripped the validator.
 */
export function retryInstructionForDetection(detected: DetectedRun[]): string {
  const summary = describeDetected(detected);
  return `\n\n【前回の出力エラー】\n外国語文字や不適切な記号が混入していました: ${summary}\n今回は**純粋な日本語のみ**で出力してください。ハングル / 半角カナ / 罫線 / IPA は一切使わないこと。`;
}
