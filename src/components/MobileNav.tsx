"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { DashboardSidebar } from "./DashboardSidebar";

/**
 * Mobile-only nav drawer for the dashboard layout. The hamburger button
 * renders inline (parent gives it a slot inside the sticky header). The
 * slide-in panel + backdrop are portaled to document.body so they escape
 * the header's stacking context — without the portal, the panel's
 * z-index would be bounded by the header (z-30) and main-content cards
 * with their own z-index could ghost on top of the drawer.
 *
 * Auto-closes when:
 *  - the user picks any sidebar link (pathname changes)
 *  - the backdrop is clicked
 *  - Esc is pressed
 *  - the viewport grows past the md breakpoint (DashboardSidebar takes over)
 *
 * Body scroll is locked while open so the page behind doesn't ghost-scroll.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close when the user navigates to a new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc to close + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Close if viewport widens past `md` (the sticky sidebar now does the job).
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth >= 768) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const drawer = (
    <>
      {/* Backdrop. z-[60] so it always sits above the sticky header (z-30)
          and any content cards on the page. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={[
          "fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-opacity md:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        ].join(" ")}
      />

      {/* Sliding panel. bg-bg-surface is a fully opaque hex (#14141f) — we
          deliberately do NOT reuse the .card class because that ships at
          60% opacity for the layered look on content pages. */}
      <aside
        id="mobile-nav-panel"
        role="dialog"
        aria-label="メニュー"
        aria-hidden={!open}
        className={[
          "fixed left-0 top-0 z-[70] h-full w-72 max-w-[85vw] border-r border-line bg-bg-surface text-ink shadow-2xl transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-14 items-center justify-between border-b border-line bg-bg-surface px-4">
          <span className="font-mono text-[10px] tracking-[0.25em] text-ink-muted">
            MENU
          </span>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition hover:bg-white/5 hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <div className="h-[calc(100vh-3.5rem)] overflow-y-auto bg-bg-surface">
          <DashboardSidebar />
        </div>
      </aside>
    </>
  );

  return (
    <>
      <button
        type="button"
        aria-controls="mobile-nav-panel"
        aria-expanded={open}
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink transition hover:bg-white/5 md:hidden"
      >
        {open ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        )}
      </button>

      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
