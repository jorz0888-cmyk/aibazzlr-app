"use client";

import { useState } from "react";

export function TagInput({
  value,
  onChange,
  placeholder = "Enter で追加",
  max,
  variant = "cyan",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  variant?: "cyan" | "danger" | "muted";
}) {
  const [draft, setDraft] = useState("");
  const colorMap = {
    cyan: "border-cyan/30 bg-cyan/10 text-cyan",
    danger: "border-danger/30 bg-danger/10 text-danger",
    muted: "border-line-strong bg-white/5 text-ink",
  } as const;

  function add(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    if (max && value.length >= max) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div
      className={[
        "flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-bg-surface px-2 py-1.5 transition focus-within:border-cyan",
        max && value.length >= max ? "opacity-80" : "",
      ].join(" ")}
    >
      {value.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className={[
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]",
            colorMap[variant],
          ].join(" ")}
        >
          {t}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-current/70 hover:text-current"
            aria-label={`${t} を削除`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (
            e.key === "Backspace" &&
            draft === "" &&
            value.length > 0
          ) {
            remove(value.length - 1);
          }
        }}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-[120px] flex-1 bg-transparent px-2 py-1 text-sm text-ink placeholder-ink-subtle outline-none"
      />
      {max && (
        <span className="px-1.5 font-mono text-[10px] text-ink-subtle">
          {value.length}/{max}
        </span>
      )}
    </div>
  );
}
