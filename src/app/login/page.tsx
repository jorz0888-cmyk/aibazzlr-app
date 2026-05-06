import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Spinner } from "@/components/Spinner";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <AuthShell
      title="ログイン"
      subtitle="AIBazzlrにサインインしてダッシュボードへ。"
      footer={
        <>
          アカウントをお持ちでない方は{" "}
          <Link className="link-cyan" href="/signup">
            新規登録
          </Link>
        </>
      }
    >
      <Suspense
        fallback={
          <div className="flex justify-center py-8">
            <Spinner size={20} />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
