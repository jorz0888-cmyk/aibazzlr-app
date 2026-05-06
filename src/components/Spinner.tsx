export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-[2px] border-cyan/25 border-t-cyan"
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}
