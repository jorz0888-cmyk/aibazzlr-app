export function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const safeCurrent = Math.max(0, Math.min(current, total));
  const pct = (safeCurrent / total) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-mono tracking-widest text-ink-muted">
          STEP {safeCurrent} / {total}
        </span>
        <span className="text-ink-subtle">
          {safeCurrent >= total ? "完了" : `あと ${total - safeCurrent} 問`}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-gradient-to-r from-cyan to-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
