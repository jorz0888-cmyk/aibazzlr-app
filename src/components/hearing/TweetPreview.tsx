type Props = {
  tweet: string;
  imageConcept?: string | null;
  brandName: string;
  handle?: string;
};

export function TweetPreview({
  tweet,
  imageConcept,
  brandName,
  handle = "@aibazzlr_demo",
}: Props) {
  const initial = brandName.charAt(0) || "A";
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur transition hover:border-cyan/25">
      <div className="flex items-start gap-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold text-bg"
          style={{
            background:
              "conic-gradient(from 180deg at 50% 50%, #00d9ff, #7F77DD, #00d9ff)",
          }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="truncate font-bold text-ink">{brandName}</span>
            <span className="text-xs text-ink-subtle">{handle}</span>
            <span className="text-xs text-ink-subtle">·</span>
            <span className="text-xs text-ink-subtle">1分前</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {tweet}
          </p>

          {imageConcept && imageConcept.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-bg/40 p-3 text-xs text-ink-muted">
              <span aria-hidden>💡</span>
              <span>
                <span className="font-mono text-cyan">イメージ画像</span>:{" "}
                {imageConcept}
              </span>
            </div>
          )}

          {/* X-style action bar (decorative) */}
          <div className="mt-4 flex items-center gap-6 text-xs text-ink-subtle">
            <span className="inline-flex items-center gap-1">
              💬 <span>—</span>
            </span>
            <span className="inline-flex items-center gap-1">
              🔁 <span>—</span>
            </span>
            <span className="inline-flex items-center gap-1">
              ♥ <span>—</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
