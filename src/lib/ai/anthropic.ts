import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client + model constants.
 * Models can be overridden via env to roll out new versions without redeploying.
 */
export const HEARING_MODEL =
  process.env.ANTHROPIC_HEARING_MODEL ?? "claude-haiku-4-5";
export const FINALIZE_MODEL =
  process.env.ANTHROPIC_FINALIZE_MODEL ?? "claude-haiku-4-5";
export const POST_MODEL =
  process.env.ANTHROPIC_POST_MODEL ?? "claude-haiku-4-5-20251001";

/**
 * Per-1k-token pricing for cost estimation. Update when Anthropic changes
 * their rate card.
 */
export const POST_MODEL_PRICE = {
  input: 0.0008, // USD per 1k input tokens
  output: 0.004, // USD per 1k output tokens
} as const;

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}
