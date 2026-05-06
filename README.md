# AIBazzlr SaaS App

> AIがX・Threads・Instagramへ毎日自動投稿。SNS運用の時間を本業に戻すSaaS。

本番URL（予定）: https://app.aibazzlr.com
LP: https://aibazzlr.com

---

## 技術スタック

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS（ダークモード固定）
- **Auth**: Supabase Auth — `@supabase/ssr`（auth-helpers-nextjs は使用しない）
- **Database**: Supabase Postgres
- **Billing**: Stripe Billing（Phase 3 で追加予定）

## ディレクトリ

```
.
├── middleware.ts                       # セッションリフレッシュ + /dashboard 保護
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # ルートレイアウト（Noto Sans JP）
│   │   ├── page.tsx                    # / → ログイン状態でリダイレクト
│   │   ├── login/                      # メール+パスワード / Google
│   │   ├── signup/                     # 新規登録 + 強度メーター
│   │   ├── forgot-password/            # リセットメール送信
│   │   ├── reset-password/             # 新パスワード設定
│   │   ├── confirm-email/              # メール確認待ち
│   │   ├── dashboard/                  # 認証必須エリア
│   │   │   ├── layout.tsx              # サイドバー + ヘッダー
│   │   │   ├── page.tsx                # 「ようこそ」ダッシュボード
│   │   │   └── sns/ posts/ analytics/ settings/   # Coming Soon
│   │   └── api/auth/callback/route.ts  # OAuth/メール確認コールバック
│   ├── components/                     # Logo / AuthShell / GoogleButton ほか
│   ├── lib/supabase/                   # client / server / middleware
│   └── types/database.ts
└── supabase/migrations/
    └── 20260506000001_create_profiles.sql
```

---

## セットアップ手順

### 1. リポジトリをクローン & 依存をインストール

```bash
git clone https://github.com/jorz0888-cmyk/aibazzlr-app.git
cd aibazzlr-app
npm install
```

### 2. Supabase プロジェクトの作成

1. https://supabase.com/dashboard で新規プロジェクト作成
2. **SQL Editor** で `supabase/migrations/20260506000001_create_profiles.sql` を実行（profiles テーブル + RLS + 自動プロフィール作成トリガー）
3. **Authentication → Providers** で `Email` と `Google` を有効化
4. **Authentication → URL Configuration** で以下を設定:
   - Site URL: `https://app.aibazzlr.com`（本番）/ `http://localhost:3000`（開発）
   - Redirect URLs:
     - `http://localhost:3000/api/auth/callback`
     - `https://app.aibazzlr.com/api/auth/callback`

### 3. 環境変数

`.env.local.example` を `.env.local` にコピーして値を埋める:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # サーバーのみ。フロントに露出させない
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

> **注意**: `.env.local` は `.gitignore` に含まれており Git にコミットされません。

### 4. 開発サーバ起動

```bash
npm run dev
# → http://localhost:3000
```

### 5. 本番ビルド

```bash
npm run build
npm start
```

---

## デザインシステム

| トークン | 値 | 用途 |
|---------|-----|------|
| `bg.DEFAULT` | `#0d0d14` | 背景 |
| `bg.surface` | `#14141f` | カード/フォーム |
| `cyan.DEFAULT` | `#00d9ff` | プライマリアクセント |
| `accent.DEFAULT` | `#7F77DD` | セカンダリアクセント（紫） |
| `ink.DEFAULT` | `#f0eeff` | 本文 |
| `ink.muted` | `#8884aa` | サブテキスト |
| `danger` | `#ff5d6c` | エラー |
| Font | `Noto Sans JP` | 全文 |

ユーティリティクラス: `.btn-primary`, `.btn-secondary`, `.input`, `.card`, `.err`, `.ok`, `.link-cyan`, `.bg-grid`

---

## ルーティング

| Path | Auth | 説明 |
|------|------|------|
| `/` | Public | セッションを見て `/login` か `/dashboard` にリダイレクト |
| `/signup` | Public | 新規登録（既ログインなら `/dashboard` へ） |
| `/login` | Public | ログイン |
| `/forgot-password` | Public | リセットメール送信 |
| `/reset-password` | Public（リンク経由） | 新パスワード設定 |
| `/confirm-email` | Public | メール確認待ち |
| `/dashboard` | **要認証** | ダッシュボード |
| `/dashboard/sns,posts,analytics,settings` | **要認証** | Coming Soon |
| `/api/auth/callback` | — | OAuth・メール確認のコールバック |

`/dashboard/**` は `middleware.ts` で保護されており、未ログインアクセスは `/login?redirect=...` にリダイレクトされます。

---

## ロードマップ

- [x] **Phase 1** — 認証基盤、ダッシュボード骨格、デザインシステム ← *今ここ*
- [ ] **Phase 2** — プロフィール編集、SNS（X/Threads/Instagram）OAuth 連携
- [ ] **Phase 3** — Stripe Billing 連携、AI投稿ジョブ、分析ダッシュボード
- [ ] **Phase 4** — チーム機能、競合分析、A/Bテスト

---

## ライセンス

UNLICENSED — © 2026 AIBazzlr Inc.
