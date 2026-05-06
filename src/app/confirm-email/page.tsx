import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthShell
      title="メールを確認してください"
      subtitle="登録を完了するため、メール内のリンクをクリックしてください。"
      footer={
        <>
          メールが届かない場合は{" "}
          <Link className="link-cyan" href="/signup">
            別のアドレスで登録
          </Link>
        </>
      }
    >
      <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-5 text-center">
        <div className="text-5xl">📩</div>
        <p className="mt-4 text-sm text-ink">
          {email ? (
            <>
              <span className="font-mono text-cyan">{email}</span>
              <br />
              宛に確認メールを送信しました。
            </>
          ) : (
            "ご登録のメールアドレス宛に確認メールを送信しました。"
          )}
        </p>
        <p className="mt-3 text-xs text-ink-muted">
          数分経っても届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
      </div>

      <Link href="/login" className="btn-secondary w-full">
        ログイン画面に戻る
      </Link>
    </AuthShell>
  );
}
