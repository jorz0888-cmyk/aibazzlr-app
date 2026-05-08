"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";

export function ChatInput({
  onSend,
  disabled,
  placeholder = "メッセージを入力...",
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to 6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 rounded-2xl border border-line-strong bg-bg-surface p-2 shadow-cyan/10 focus-within:border-cyan/50"
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent px-3 py-2 text-sm text-ink placeholder-ink-subtle outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan text-bg transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:brightness-110"
        aria-label="送信"
      >
        {disabled ? (
          <Spinner size={14} />
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        )}
      </button>
    </form>
  );
}
