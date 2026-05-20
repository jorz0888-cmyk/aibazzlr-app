/**
 * Phase 11.5: catalogue of friendly error messages for the codes that the
 * server emits in `error` (or `error.code`) fields. Used both in route
 * handlers (when we want a default Japanese message) and in client error
 * displays.
 */

export type ErrorCode =
  | "monthly_post_quota_exceeded"
  | "monthly_image_quota_exceeded"
  | "ai_config_quota_exceeded"
  | "daily_quota_exceeded"
  | "image_upload_size_exceeded"
  | "image_upload_format_invalid"
  | "x_account_not_connected"
  | "x_post_forbidden"
  | "x_rate_limit"
  | "gemini_quota_exceeded"
  | "gemini_not_configured"
  | "subscription_required"
  | "internal_server_error";

export type ErrorMessage = {
  title: string;
  description: string;
  cta?: { label: string; href: string };
};

export const ERROR_MESSAGES: Record<ErrorCode, ErrorMessage> = {
  monthly_post_quota_exceeded: {
    title: "今月の投稿上限に達しました",
    description:
      "プランをアップグレードすると、より多くの投稿が可能になります。来月になると自動的にリセットされます。",
    cta: { label: "プランを見る", href: "/dashboard/billing" },
  },
  monthly_image_quota_exceeded: {
    title: "AI 画像生成の上限に達しました",
    description:
      "今月の AI 画像生成枠を使い切りました。アップロード済みの写真ライブラリは引き続き使えます。",
    cta: { label: "プランを見る", href: "/dashboard/billing" },
  },
  ai_config_quota_exceeded: {
    title: "AI 設定の数が上限に達しました",
    description:
      "プランをアップグレードすると、より多くの AI 設定が作成できます。",
    cta: { label: "プランを見る", href: "/dashboard/billing" },
  },
  daily_quota_exceeded: {
    title: "本日の利用上限に達しました",
    description: "明日になると自動的にリセットされます。",
  },
  image_upload_size_exceeded: {
    title: "画像サイズが大きすぎます",
    description: "5MB 以下の画像を選択してください。",
  },
  image_upload_format_invalid: {
    title: "対応していない画像形式です",
    description: "JPG / PNG / WebP 形式の画像を選択してください。",
  },
  x_account_not_connected: {
    title: "X アカウントが連携されていません",
    description: "ダッシュボードから X アカウントを連携してください。",
    cta: { label: "SNS 連携へ", href: "/dashboard/sns" },
  },
  x_post_forbidden: {
    title: "X 投稿が拒否されました",
    description:
      "新規 X アカウントの場合、API 投稿が制限されることがあります。「コピペで投稿」モードをお試しください。",
  },
  x_rate_limit: {
    title: "X 投稿のレート制限に達しました",
    description: "しばらく時間をおいてから再度お試しください。",
  },
  gemini_quota_exceeded: {
    title: "一時的に AI 画像生成が利用できません",
    description: "しばらく時間をおいてから再度お試しください。",
  },
  gemini_not_configured: {
    title: "AI 画像生成は現在準備中です",
    description:
      "アップロード済みの写真ライブラリは引き続きご利用いただけます。",
  },
  subscription_required: {
    title: "有料プランへの加入が必要です",
    description:
      "この機能をご利用いただくには、Standard または Premium プランへの加入が必要です。",
    cta: { label: "プランを見る", href: "/dashboard/billing" },
  },
  internal_server_error: {
    title: "エラーが発生しました",
    description:
      "時間をおいて再度お試しください。問題が続く場合はサポートまでご連絡ください。",
  },
};

const KNOWN_CODES = new Set(Object.keys(ERROR_MESSAGES));

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

/**
 * Look up the friendly message for a code, or fall back to the generic
 * internal-server-error entry. Unknown / non-string inputs are also routed
 * to the fallback, so this never throws.
 */
export function getErrorMessage(code: string | null | undefined): ErrorMessage {
  if (isErrorCode(code)) return ERROR_MESSAGES[code];
  return ERROR_MESSAGES.internal_server_error;
}

/**
 * Try to extract a known error code from an API response payload. Supports
 * both the legacy `{ error: "code_string", message: "..." }` shape and the
 * new `{ error: { code: "...", message: "..." } }` shape.
 */
export function extractErrorCode(payload: unknown): {
  code: ErrorCode | null;
  message: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { code: null, message: null };
  }
  const obj = payload as {
    error?: unknown;
    message?: unknown;
  };
  let candidate: unknown = null;
  let message: string | null = null;
  if (typeof obj.error === "string") {
    candidate = obj.error;
  } else if (obj.error && typeof obj.error === "object") {
    const inner = obj.error as { code?: unknown; message?: unknown };
    candidate = inner.code;
    if (typeof inner.message === "string") message = inner.message;
  }
  if (typeof obj.message === "string" && !message) message = obj.message;
  return {
    code: isErrorCode(candidate) ? candidate : null,
    message,
  };
}
