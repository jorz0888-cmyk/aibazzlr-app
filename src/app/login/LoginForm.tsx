"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GoogleButton } from "@/components/GoogleButton";
import { Spinner } from "@/components/Spinner";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(translate(error.message));
      setLoading(false);
      return;
    }
    const next = search.get("redirect") ?? "/dashboard";
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <GoogleButton label="Googleでログイン" />

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
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label !mb-0" htmlFor="password">
              パスワード
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-ink-muted hover:text-cyan"
            >
              パスワードをお忘れですか？
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="err">{error}</div>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? <Spinner /> : "ログイン"}
        </button>
      </form>
    </>
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
  if (msg.includes("Invalid login credentials"))
    return "メールアドレスまたはパスワードが正しくありません。";
  if (msg.includes("Email not confirmed"))
    return "メール確認が完了していません。受信トレイをご確認ください。";
  return msg;
}
