import { extractErrorCode, getErrorMessage } from "./messages";

/**
 * Phase 11.5: pull a user-friendly Japanese string out of an arbitrary API
 * payload. Prefers, in order:
 *   1. `message` (existing routes already supply a JP-friendly string)
 *   2. catalogue lookup on the error code (`error.code` or string `error`)
 *   3. generic internal-server-error fallback
 */
export function friendlyErrorMessage(payload: unknown): string {
  const { code, message } = extractErrorCode(payload);
  if (message) return message;
  if (code) return `${getErrorMessage(code).title} — ${getErrorMessage(code).description}`;
  return getErrorMessage(null).title;
}

/**
 * Thin wrapper for `fetch` + JSON that throws an Error whose `.message` is
 * already user-friendly Japanese. Use for client-side mutations.
 */
export async function postJsonFriendly<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, init);
  const payload = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new Error(friendlyErrorMessage(payload));
  }
  return payload;
}
