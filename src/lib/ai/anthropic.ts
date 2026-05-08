import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client + model constants.
 * Models can be overridden via env to roll out new versions without redeploying.
 */
export const HEARING_MODEL =
  process.env.ANTHROPIC_HEARING_MODEL ?? "claude-sonnet-4-5";
export const FINALIZE_MODEL =
  process.env.ANTHROPIC_FINALIZE_MODEL ?? "claude-sonnet-4-5";

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
