export function ChatBubble({
  role,
  children,
  streaming = false,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-cyan/15 px-4 py-3 text-sm leading-relaxed text-ink">
          <div className="whitespace-pre-wrap break-words">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
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
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-line bg-accent/10 px-4 py-3 text-sm leading-relaxed text-ink">
        <div className="whitespace-pre-wrap break-words">
          {children}
          {streaming && <BlinkingCursor />}
        </div>
      </div>
    </div>
  );
}

function BlinkingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-cyan align-baseline"
      style={{ boxShadow: "0 0 6px rgba(0,217,255,0.5)" }}
      aria-hidden
    />
  );
}
