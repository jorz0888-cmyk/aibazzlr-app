import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AIBazzlr — SNSは、AIが回す時代へ。",
    template: "%s | AIBazzlr",
  },
  description:
    "X・Threads・Instagramへの投稿をAIが毎日自動で。SNS運用の時間を本業に戻すSaaS。",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.aibazzlr.com",
  ),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
