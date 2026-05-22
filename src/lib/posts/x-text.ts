/**
 * X's "weighted character" counter (matches twitter-text v3 defaults).
 *
 * Why this exists: JavaScript's `.length` counts a Hiragana/Kanji char as
 * 1, but X counts it as 2. So a JP draft that says "280 chars" by
 * `.length` actually scores ~560 weighted on X's side and gets rejected
 * with 403/422. We need to compute the value X will see BEFORE sending
 * the request.
 *
 * The default ranges from twitter-text 3.0 (basically: most Latin and
 * general punctuation = weight 1, everything else = weight 2):
 *
 *   Range            Weight
 *   ─────────────    ──────
 *   U+0000-U+10FF    1   (Latin, Greek, Cyrillic, Arabic, Hebrew, Thai,
 *                         Devanagari, Hangul jamo, Vietnamese, Indic)
 *   U+2000-U+200D    1   (General Punctuation, ZWJ)
 *   U+202F           1   (Narrow no-break space)
 *   U+2032-U+2037    1   (Prime / triple prime / quotes)
 *   U+2057           1   (Quadruple prime)
 *   everything else  2   (CJK ideographs, Hiragana, Katakana, Hangul
 *                         syllables, emoji, full-width punctuation, etc.)
 *
 * URLs are flattened to a fixed weight of 23 — X's `t.co` wrapper rewrites
 * them regardless of original length. We detect `http://` and `https://`.
 */

const URL_WEIGHT = 23;
const URL_RE = /https?:\/\/[^\s]+/gi;

function codePointWeight(cp: number): 1 | 2 {
  if (cp <= 0x10ff) return 1;
  if (cp >= 0x2000 && cp <= 0x200d) return 1;
  if (cp === 0x202f) return 1;
  if (cp >= 0x2032 && cp <= 0x2037) return 1;
  if (cp === 0x2057) return 1;
  return 2;
}

/** X-weighted length of a single string (no URL handling). */
export function weightedLength(text: string): number {
  let total = 0;
  // for..of iterates by Unicode code point — handles surrogate pairs
  // (emoji, supplementary kanji) correctly. Using .length / .charCodeAt
  // would double-count those.
  for (const ch of text) {
    total += codePointWeight(ch.codePointAt(0) ?? 0);
  }
  return total;
}

/**
 * X-weighted length with URL handling — replace every URL with a
 * 23-weight constant, then weight-count the remainder.
 */
export function weightedTweetLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  const stripped = text.replace(URL_RE, "");
  return urls.length * URL_WEIGHT + weightedLength(stripped);
}

/**
 * Compose the body+hashtags string the way the publisher posts it
 * ("content\n\nhashtags") and return its X-weighted length. Mirrors
 * buildTweetText() so the generator/validator/publisher all agree.
 */
export function weightedRenderedTweet(
  content: string,
  hashtags: string[],
): number {
  const tags = (hashtags ?? []).filter(Boolean).join(" ");
  const rendered = tags ? `${content}\n\n${tags}` : content;
  return weightedTweetLength(rendered);
}

/**
 * If the rendered tweet exceeds `maxWeighted`, trim the content (NOT the
 * hashtags — they're the most likely SEO-load-bearing part of the post)
 * down to the largest prefix that still fits, then append `…` and
 * re-check. Hashtags are preserved verbatim. If even hashtags + ellipsis
 * + 1 content char don't fit, we strip hashtags as a last resort.
 *
 * Returns the new (content, hashtags) pair plus a `truncated` flag the
 * caller can log/surface.
 */
export function truncateRenderedTweet(
  content: string,
  hashtags: string[],
  maxWeighted: number,
): { content: string; hashtags: string[]; truncated: boolean } {
  const original = weightedRenderedTweet(content, hashtags);
  if (original <= maxWeighted) {
    return { content, hashtags, truncated: false };
  }

  // Greedy binary-ish trim: cut by Unicode code-point units, not by JS
  // code units. Iterate from longest acceptable suffix to find the
  // longest content prefix whose [content+…+\n\n+hashtags] fits.
  const chars = [...content]; // splits by code point
  const ELLIPSIS = "…";
  let trimmed: string[] = chars.slice();
  while (
    trimmed.length > 0 &&
    weightedRenderedTweet(trimmed.join("") + ELLIPSIS, hashtags) > maxWeighted
  ) {
    trimmed.pop();
  }
  if (trimmed.length > 0) {
    return {
      content: trimmed.join("") + ELLIPSIS,
      hashtags,
      truncated: true,
    };
  }

  // Even one content char + hashtags doesn't fit → drop hashtags too.
  const fallbackChars = [...content];
  let fallback: string[] = fallbackChars.slice();
  while (
    fallback.length > 0 &&
    weightedRenderedTweet(fallback.join("") + ELLIPSIS, []) > maxWeighted
  ) {
    fallback.pop();
  }
  return {
    content: fallback.join("") + (fallback.length > 0 ? ELLIPSIS : ""),
    hashtags: [],
    truncated: true,
  };
}
