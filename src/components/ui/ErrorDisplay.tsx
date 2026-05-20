import Link from "next/link";
import { getErrorMessage, isErrorCode } from "@/lib/errors/messages";

/**
 * Friendly error block. Pass either a known error `code` from
 * `src/lib/errors/messages.ts` or a plain `fallbackMessage` string. When a
 * code is given the title / description / CTA come from the catalogue.
 */
export function ErrorDisplay({
  code,
  fallbackMessage,
  compact = false,
}: {
  code?: string | null;
  fallbackMessage?: string | null;
  compact?: boolean;
}) {
  // If `code` isn't actually a known code, fall through to the raw
  // fallbackMessage path so we don't pretend it's an internal error.
  if (isErrorCode(code)) {
    const msg = getErrorMessage(code);
    return (
      <div
        className={[
          "rounded-md border border-danger/40 bg-danger/10 text-danger",
          compact ? "p-2 text-xs" : "p-3 text-sm",
        ].join(" ")}
        role="alert"
      >
        <p className="font-bold">{msg.title}</p>
        <p className="mt-1 text-ink-muted">{msg.description}</p>
        {msg.cta && (
          <Link
            href={msg.cta.href}
            className="link-cyan mt-2 inline-block text-xs"
          >
            {msg.cta.label} →
          </Link>
        )}
      </div>
    );
  }

  if (fallbackMessage) {
    return (
      <div
        className={[
          "rounded-md border border-danger/40 bg-danger/10 text-danger",
          compact ? "p-2 text-xs" : "p-3 text-sm",
        ].join(" ")}
        role="alert"
      >
        {fallbackMessage}
      </div>
    );
  }

  return null;
}
