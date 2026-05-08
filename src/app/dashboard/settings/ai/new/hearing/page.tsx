import { Suspense } from "react";
import { Spinner } from "@/components/Spinner";
import { HearingStarter } from "./HearingStarter";

export default function HearingStartPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── AI HEARING
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          ヒアリングを始めましょう
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          まずは業種を教えてください。これに合わせてAIが質問を最適化します。
          選んだ後でも会話の中で柔軟に変更されます。
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card grid place-items-center py-16">
            <Spinner size={20} />
          </div>
        }
      >
        <HearingStarter />
      </Suspense>
    </div>
  );
}
