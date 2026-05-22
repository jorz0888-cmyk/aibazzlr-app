import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Public contact form endpoint, called cross-origin from the static
 * LP at www.aibazzlr.com. Sends a notification email to the support
 * inbox via Resend.
 *
 * Why cross-origin POST: the LP is intentionally a static HTML repo
 * (no Node runtime), so this lives on the Next app side and is
 * CORS-allow-listed for the production + staging LP origins.
 *
 * Resend was chosen because the codebase had no prior email utility
 * (no SMTP, nodemailer, SendGrid wiring). Resend's REST + key model
 * is the lightest add for a single transactional sender. Required
 * env vars in the Vercel app project:
 *   - RESEND_API_KEY        — Resend API key (re_…)
 *   - CONTACT_FROM_EMAIL    — verified sender, default
 *                              "AIBazzlr <noreply@aibazzlr.com>"
 *   - CONTACT_TO_EMAIL      — recipient, default "support@aibazzlr.com"
 */

const ALLOWED_ORIGINS = new Set([
  "https://www.aibazzlr.com",
  "https://aibazzlr.com",
  // Preview deployments — the LP is also served from *.vercel.app on PRs.
  // Match the full origin in `corsHeaders` for those cases.
]);

function corsHeaders(origin: string | null): Record<string, string> {
  // Explicit allow-list for production, plus a vercel.app preview pattern.
  let allow: string | null = null;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    allow = origin;
  } else if (origin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
    allow = origin;
  } else if (
    origin &&
    /^http:\/\/localhost(:\d+)?$/.test(origin)
  ) {
    allow = origin;
  }
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

type ContactBody = {
  name?: unknown;
  email?: unknown;
  inquiry_type?: unknown;
  message?: unknown;
  /** Honeypot — real users never fill this hidden field. */
  website?: unknown;
};

function readString(v: unknown, max = 2000): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isValidEmail(s: string): boolean {
  // Pragmatic check — the real validator is whether Resend's reply-to
  // delivers. We just stop the obvious typos / unfilled-field cases.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

function inquiryLabel(t: string): string {
  if (t === "business" || t === "法人" || t === "corporate") return "法人";
  return "一般";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  let body: ContactBody;
  try {
    body = (await request.json()) as ContactBody;
  } catch {
    return NextResponse.json(
      { error: "リクエストの形式が不正です" },
      { status: 400, headers },
    );
  }

  // Honeypot — bots happily fill every field they can see. If `website`
  // came back populated, drop the request silently with 200 so the bot
  // thinks it worked and stops retrying. NEVER actually email anything.
  const honeypot = readString(body.website);
  if (honeypot.length > 0) {
    console.warn("[contact] honeypot hit — dropping", {
      origin,
      honeypotLen: honeypot.length,
    });
    return NextResponse.json({ ok: true }, { status: 200, headers });
  }

  const name = readString(body.name, 200);
  const email = readString(body.email, 254);
  const inquiryType = readString(body.inquiry_type, 20);
  const message = readString(body.message, 5000);

  const errors: string[] = [];
  if (name.length === 0) errors.push("お名前は必須です");
  if (email.length === 0) errors.push("メールアドレスは必須です");
  else if (!isValidEmail(email))
    errors.push("メールアドレスの形式が正しくありません");
  if (message.length === 0) errors.push("お問い合わせ内容は必須です");

  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.join(" / ") },
      { status: 400, headers },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[contact] RESEND_API_KEY is not configured");
    return NextResponse.json(
      {
        error:
          "メール送信の設定に問題があります。お手数ですが support@aibazzlr.com まで直接ご連絡ください。",
      },
      { status: 500, headers },
    );
  }

  const fromAddr =
    process.env.CONTACT_FROM_EMAIL ?? "AIBazzlr <noreply@aibazzlr.com>";
  const toAddr = process.env.CONTACT_TO_EMAIL ?? "support@aibazzlr.com";
  const label = inquiryLabel(inquiryType);
  const subject = `【${label}】お問い合わせ - ${name}`;

  const text = [
    `AIBazzlr のお問い合わせフォームから送信されました。`,
    ``,
    `── 種別 ──`,
    label,
    ``,
    `── お名前 ──`,
    name,
    ``,
    `── メールアドレス ──`,
    email,
    ``,
    `── お問い合わせ内容 ──`,
    message,
    ``,
    `──`,
    `送信元 Origin: ${origin ?? "(unknown)"}`,
    `User-Agent  : ${request.headers.get("user-agent") ?? "(unknown)"}`,
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    const res = await resend.emails.send({
      from: fromAddr,
      to: [toAddr],
      replyTo: email,
      subject,
      text,
    });
    if (res.error) {
      console.error("[contact] Resend rejected the send", res.error);
      return NextResponse.json(
        {
          error: `送信に失敗しました（${res.error.message ?? "Resend error"}）。お手数ですが support@aibazzlr.com まで直接ご連絡ください。`,
        },
        { status: 502, headers },
      );
    }
    console.log("[contact] sent", {
      messageId: res.data?.id,
      label,
      to: toAddr,
    });
    return NextResponse.json({ ok: true }, { status: 200, headers });
  } catch (e) {
    console.error("[contact] Resend call threw", e);
    return NextResponse.json(
      {
        error: `送信に失敗しました。お手数ですが support@aibazzlr.com まで直接ご連絡ください。`,
      },
      { status: 502, headers },
    );
  }
}
