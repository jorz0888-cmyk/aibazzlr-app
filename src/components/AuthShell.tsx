import { Logo } from "./Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="bg-grid relative min-h-screen">
      <header className="absolute left-0 right-0 top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Logo size="sm" href="/" />
        </div>
      </header>

      <div className="flex min-h-screen items-center justify-center px-6 py-24">
        <div className="card w-full max-w-md p-8 sm:p-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>
          )}
          <div className="mt-8 space-y-5">{children}</div>
          {footer && (
            <div className="mt-8 border-t border-line pt-6 text-center text-sm text-ink-muted">
              {footer}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
