"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export type ToastInput = {
  variant: ToastVariant;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  durationMs?: number;
};

type ToastItem = ToastInput & { id: string };

type ToastContextValue = {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  success: (
    title: string,
    rest?: Omit<ToastInput, "variant" | "title">,
  ) => string;
  error: (
    title: string,
    rest?: Omit<ToastInput, "variant" | "title">,
  ) => string;
  info: (
    title: string,
    rest?: Omit<ToastInput, "variant" | "title">,
  ) => string;
};

const Ctx = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Fall back to a no-op implementation rather than throwing — useful in
    // server-rendered fragments and in unit tests.
    return {
      push: () => "",
      dismiss: () => {},
      success: () => "",
      error: () => "",
      info: () => "",
    };
  }
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput): string => {
      counter.current += 1;
      const id = `toast-${Date.now()}-${counter.current}`;
      const item: ToastItem = { ...input, id };
      setItems((xs) => [...xs, item]);
      const dur = input.durationMs ?? 6000;
      if (dur > 0) setTimeout(() => dismiss(id), dur);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, rest) => push({ variant: "success", title, ...rest }),
      error: (title, rest) =>
        push({ variant: "error", title, durationMs: 8000, ...rest }),
      info: (title, rest) => push({ variant: "info", title, ...rest }),
    }),
    [push, dismiss],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Toast viewport — bottom-right on desktop, full-width on mobile */}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col gap-2 sm:bottom-6 sm:right-6 sm:left-auto sm:max-w-sm"
        role="region"
        aria-label="通知"
      >
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const palette =
    toast.variant === "success"
      ? "border-success/40 bg-success/10"
      : toast.variant === "error"
        ? "border-danger/40 bg-danger/10"
        : "border-cyan/40 bg-cyan/10";
  const accent =
    toast.variant === "success"
      ? "text-success"
      : toast.variant === "error"
        ? "text-danger"
        : "text-cyan";
  const icon =
    toast.variant === "success" ? "✅" : toast.variant === "error" ? "❌" : "ℹ️";

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={[
        "pointer-events-auto card flex items-start gap-3 p-4 shadow-cyan transition-all duration-200",
        palette,
        enter ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      ].join(" ")}
    >
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className={`text-sm font-bold ${accent}`}>{toast.title}</div>
        {toast.description && (
          <div className="text-xs leading-relaxed text-ink">
            {toast.description}
          </div>
        )}
        {toast.action && (
          <div className="pt-1">
            {toast.action.href ? (
              <a
                href={toast.action.href}
                target="_blank"
                rel="noopener noreferrer"
                className="link-cyan inline-flex items-center gap-1 text-xs font-semibold"
                onClick={() => onDismiss()}
              >
                {toast.action.label} →
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick?.();
                  onDismiss();
                }}
                className="link-cyan text-xs font-semibold"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-ink-subtle transition hover:text-ink"
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
}
