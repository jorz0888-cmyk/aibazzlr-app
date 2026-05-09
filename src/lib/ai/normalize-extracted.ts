import {
  normalizeAccountMode,
  type AccountMode,
  type ExtractedHearingData,
} from "@/lib/supabase/types";

/**
 * Coerce arbitrary input into a string[] so DB writes don't blow up when
 * Claude returns a string ("A、B、C") or null where an array was expected.
 */
function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[、,・\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function toStr(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Take whatever Claude (or a fallback path) gave us and return a fully-shaped
 * ExtractedHearingData with sensible defaults for every field. Never throws.
 *
 * Real-mode-only fields are populated only when account_mode === 'real';
 * for fictional mode they remain undefined so they don't pollute the v14
 * prompt template.
 */
export function normalizeExtractedData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
  fallbackMode: AccountMode = "real",
): ExtractedHearingData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const accountMode = normalizeAccountMode(data.account_mode ?? fallbackMode);
  const businessName = toStr(data.business_name);
  const name = toStr(data.name) || businessName || "";
  const industry = toStr(data.industry);

  const base: ExtractedHearingData = {
    complete: true,
    account_mode: accountMode,
    industry,
    business_name: businessName || name,
    business_description: toStr(data.business_description),
    persona_role: toStr(data.persona_role),
    world_view: toStr(data.world_view),
    voice_tone: toStr(data.voice_tone) || "casual_polite",
    target_audience: toStr(data.target_audience),
    must_include_elements: toArray(data.must_include_elements),
    good_examples: toArray(data.good_examples),
    ng_words: toArray(data.ng_words),
    hashtag_pool: toArray(data.hashtag_pool),
    summary_message: toStr(data.summary_message),
  };

  if (accountMode === "real") {
    return {
      ...base,
      business_hours: toStr(data.business_hours),
      closed_days: toStr(data.closed_days),
      address: toStr(data.address),
      price_range: toStr(data.price_range),
      menu_items: toArray(data.menu_items),
      seasonal_items: toArray(data.seasonal_items),
      real_episodes: toArray(data.real_episodes),
      announcement_topics: toArray(data.announcement_topics),
    };
  }

  return base;
}

/**
 * Resolve the AI-config display name for an extracted result. Used both by
 * /save and as the seed for the preview-page name input.
 */
export function pickConfigName(d: ExtractedHearingData): string {
  return (
    d.business_name?.trim() ||
    d.industry?.trim() ||
    "新しいAI設定"
  );
}
