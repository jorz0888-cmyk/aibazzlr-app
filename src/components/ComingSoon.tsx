export function ComingSoon({
  title,
  description,
  phase = "Phase 3",
}: {
  title: string;
  description: string;
  phase?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.25em] text-cyan">
          ── {phase.toUpperCase()}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{description}</p>
      </div>

      <div className="card grid place-items-center px-6 py-20 text-center">
        <div className="text-5xl">🚧</div>
        <h2 className="mt-4 text-lg font-bold text-ink">Coming Soon</h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          この機能は{phase}で実装予定です。お待ちいただきありがとうございます。
        </p>
        <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 font-mono text-[10px] tracking-widest text-cyan">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
          IN DEVELOPMENT
        </span>
      </div>
    </div>
  );
}
