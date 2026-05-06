"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "ダッシュボード", icon: "📊" },
  { href: "/dashboard/sns", label: "SNS連携", icon: "🔗", soon: true },
  { href: "/dashboard/posts", label: "投稿設定", icon: "✍️", soon: true },
  { href: "/dashboard/analytics", label: "分析", icon: "📈", soon: true },
  { href: "/dashboard/settings", label: "設定", icon: "⚙️", soon: true },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-4">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-cyan/10 text-cyan"
                : "text-ink-muted hover:bg-white/5 hover:text-ink",
            ].join(" ")}
          >
            <span className="text-base">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.soon && (
              <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[9px] tracking-wider text-ink-subtle">
                SOON
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
