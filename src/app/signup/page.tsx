"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";
import { Spinner } from "@/components/Spinner";
import { ErrorDisplay } from "@/components/ui/ErrorDisplay";

type Strength = { label: string; color: string; pct: number };

function scorePassword(pw: string): Strength {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map: Record<number, Strength> = {
    0: { label: "弱い", color: "bg-danger", pct: 10 },
    1: { label: "弱い", color: "bg-danger", pct: 25 },
    2: { label: "やや弱い", color: "bg-orange-400", pct: 45 },
    3: { label: "普通", color: "bg-yellow-400", pct: 65 },
    4: { label: "強い", color: "bg-success", pct: 85 },
    5: { label: "非常に強い", color: "bg-cyan", pct: 100 },
  };
  return map[score];
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // `code` routes through the i18n error catalogue (with optional CTA link);
  // `message` is the plain-string fallback for codes the catalogue doesn't
  // know about (validation, raw Supabase errors).
  const [error, setError] = useState<{
    code?: string;
    message?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = scorePassword(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError({ message: "パスワードは8文字以上で設定してください。" });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    });

    if (signUpError) {
      // Some Supabase deployments DO return a "User already registered"
      // error directly — translate it to our catalogue code so the user
      // gets the ログイン画面へ link CTA as well.
      if (signUpError.message.toLowerCase().includes("already")) {
        setError({ code: "email_already_registered" });
      } else {
        setError({ message: translate(signUpError.message) });
      }
      setLoading(false);
      return;
    }

    // Supabase's "secure email signups" returns data.user with an empty
    // `identities` array when the address is already registered. There is
    // no `error`, no email is sent, and the user otherwise sits on
    // /confirm-email forever waiting for a mail that never arrives. Detect
    // that case here and surface the same friendly login-CTA error.
    if (data?.user && (data.user.identities?.length ?? 0) === 0) {
      setError({ code: "email_already_registered" });
      setLoading(false);
      return;
    }

    router.push(`/confirm-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell
      title="新規登録"
      subtitle="7日間の無料トライアルで、AIBazzlrを今すぐ試す。"
      footer={
        <>
          すでにアカウントをお持ちですか？{" "}
          <Link className="link-cyan" href="/login">
            ログイン
          </Link>
        </>
      }
    >
      <GoogleButton label="Googleで新規登録" />

      <Divider />

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            メールアドレス
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            パスワード（8文字以上）
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password.length > 0 && (
            <div className="mt-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full transition-all ${strength.color}`}
                  style={{ width: `${strength.pct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                強度: {strength.label}
              </p>
            </div>
          )}
        </div>

        {error && (
          <ErrorDisplay code={error.code} fallbackMessage={error.message} />
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? <Spinner /> : "登録してメール確認に進む"}
        </button>

        <p className="pt-1 text-[11px] leading-relaxed text-ink-subtle">
          続行することで、
          <a
            href="https://aibazzlr.com/terms.html"
            target="_blank"
            rel="noopener"
            className="link-cyan"
          >
            利用規約
          </a>
          および
          <a
            href="https://aibazzlr.com/privacy.html"
            target="_blank"
            rel="noopener"
            className="link-cyan"
          >
            プライバシーポリシー
          </a>
          に同意したものとみなされます。
        </p>
      </form>
    </AuthShell>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-subtle">
      <span className="h-px flex-1 bg-line" />
      OR
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function translate(msg: string) {
  if (msg.toLowerCase().includes("already registered"))
    return "このメールアドレスは既に登録されています。ログインをお試しください。";
  if (msg.toLowerCase().includes("password"))
    return "パスワードの形式が正しくありません。8文字以上で設定してください。";
  return msg;
}
