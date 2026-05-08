export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-bg"
        style={{
          background:
            "conic-gradient(from 180deg at 50% 50%, #00d9ff, #7F77DD, #00d9ff)",
        }}
        aria-hidden
      >
        AI
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-line bg-accent/10 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Dot delay={0} />
          <Dot delay={150} />
          <Dot delay={300} />
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-cyan/70"
      style={{ animationDelay: `${delay}ms` }}
      aria-hidden
    />
  );
}
