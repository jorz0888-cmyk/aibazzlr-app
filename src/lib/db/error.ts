/**
 * Helpers for extracting human-readable info from Supabase / Postgres errors.
 *
 * Supabase rejects with PostgrestError-shaped plain objects, NOT real Error
 * instances. Doing `String(err)` or `err instanceof Error ? err.message : ""`
 * therefore yields `"[object Object]"`. Use these helpers everywhere.
 */

export type DbErrorInfo = {
  code: string | null;
  message: string;
  hint: string | null;
  details: string | null;
};

/**
 * Pull a useful string out of any thrown value, regardless of whether it's an
 * Error, a PostgrestError, an object with .message, or something else.
 */
function pickMessage(e: unknown): string {
  if (e === null || e === undefined) return "詳細不明のエラー";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const obj = e as { message?: unknown };
    if (typeof obj.message === "string" && obj.message) return obj.message;
    // .message itself might be an object → recurse one level
    if (obj.message && typeof obj.message === "object") {
      const inner = (obj.message as { message?: unknown }).message;
      if (typeof inner === "string" && inner) return inner;
    }
    if (e instanceof Error && e.message) return e.message;
    // Last resort: stringify the whole object so something useful surfaces in
    // logs rather than "[object Object]".
    try {
      return JSON.stringify(e);
    } catch {
      return "詳細不明のエラー";
    }
  }
  return String(e);
}

function pickStringField(e: unknown, key: string): string | null {
  if (e && typeof e === "object") {
    const v = (e as Record<string, unknown>)[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export function extractDbError(e: unknown): DbErrorInfo {
  return {
    code: pickStringField(e, "code"),
    message: pickMessage(e),
    hint: pickStringField(e, "hint"),
    details: pickStringField(e, "details"),
  };
}

/** One-line summary, useful for top-level UI strings. */
export function describeDbError(e: unknown): string {
  const info = extractDbError(e);
  const parts: string[] = [];
  if (info.code) parts.push(`[${info.code}]`);
  parts.push(info.message);
  if (info.details) parts.push(info.details);
  if (info.hint) parts.push(`hint: ${info.hint}`);
  return parts.join(" ");
}
