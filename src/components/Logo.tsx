import Link from "next/link";

export function Logo({
  size = "md",
  href = "/",
}: {
  size?: "sm" | "md";
  href?: string | null;
}) {
  const dim = size === "sm" ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-[13px]";
  const text = size === "sm" ? "text-[15px]" : "text-[17px]";

  const inner = (
    <span className="inline-flex items-center gap-2 font-extrabold tracking-tight">
      <span
        className={`relative grid place-items-center rounded-lg ${dim}`}
        aria-hidden
      >
        <span
          className="absolute inset-0 rounded-lg"
          style={{
            background:
              "conic-gradient(from 180deg at 50% 50%, #00d9ff, #7F77DD, #00d9ff)",
          }}
        />
        <span className="absolute inset-[2px] rounded-md bg-bg" />
        <span className="relative z-10 font-mono text-cyan">A</span>
      </span>
      <span className={`${text} text-ink`}>
        AI<span className="text-cyan">Bazzlr</span>
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="inline-flex">
      {inner}
    </Link>
  );
}
