# Google OAuth セットアップ手順書

## 現状

ログイン画面で「Google でログイン」を押すと以下のエラー:

```json
{
  "code": 400,
  "error_code": "validation_failed",
  "msg": "Unsupported provider: provider is not enabled"
}
```

これは Supabase 側で Google Provider が **未設定** なため。
このドキュメントの手順を上から順に実行すれば解消します（所要 10〜15 分）。

## 確認できたこと（自動チェック）

- Supabase MCP には Auth Provider の設定状態を取得する API は無いため、コードベースから直接の状態確認はできません
- ただし、エラーメッセージ `provider is not enabled` から原因は確定（Provider OFF）
- フロントエンドのログインボタンは正常に動作（OAuth 認証コードに正しく到達）

## 修復手順

### A. Google Cloud Console で OAuth Client を作成

1. https://console.cloud.google.com にアクセス（j.orz0888@gmail.com でログイン）
2. プロジェクトを作成または既存を選択
   - 推奨プロジェクト名: `aibazzlr-prod`
3. 左メニュー → **APIs & Services → Credentials**
4. 上部 **+ CREATE CREDENTIALS → OAuth client ID**
5. アプリの種類: **Web application**
6. 名前: `AIBazzlr Web Auth`
7. **Authorized JavaScript origins** に以下を追加:
   ```
   https://app.aibazzlr.com
   https://squxuzfpdugpjjgnryoe.supabase.co
   http://localhost:3000
   ```
   （localhost は開発用に入れておく）
8. **Authorized redirect URIs** に以下を追加:
   ```
   https://squxuzfpdugpjjgnryoe.supabase.co/auth/v1/callback
   ```
9. **CREATE** をクリック
10. 表示された **Client ID** と **Client Secret** をコピー（後で Supabase に貼り付ける）

### B. OAuth consent screen（同意画面）の設定

初回のみ必要。既に設定済みならスキップ。

1. 左メニュー → **APIs & Services → OAuth consent screen**
2. **User Type: External** を選択 → **CREATE**
3. App information:
   - App name: `AIBazzlr`
   - User support email: `j.orz0888@gmail.com`
   - App logo: 任意（後で追加可）
4. App domain（任意）:
   - Application home page: `https://aibazzlr.com`
   - Privacy policy: `https://aibazzlr.com/privacy`（用意してれば）
   - Terms of service: `https://aibazzlr.com/terms`（用意してれば）
5. Authorized domains:
   ```
   aibazzlr.com
   supabase.co
   ```
6. Developer contact: `j.orz0888@gmail.com`
7. **SAVE AND CONTINUE**
8. Scopes 画面で **ADD OR REMOVE SCOPES** をクリックし、以下を選択:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
   （これらは Supabase が要求する最小スコープ）
9. **UPDATE → SAVE AND CONTINUE**
10. Test users 画面: ベータ前なら自分のメールを追加して **SAVE AND CONTINUE**
11. Summary 確認 → **BACK TO DASHBOARD**
12. **OPTIONAL（公開後）**: 後で「Publish app」をクリックすれば誰でもログイン可に

### C. Supabase に Client ID / Secret を設定

1. https://supabase.com/dashboard/project/squxuzfpdugpjjgnryoe/auth/providers を開く
2. **Google** を見つけて **Enable** トグルを ON
3. フォーム入力:
   - **Client ID (for OAuth)**: A-10 でコピーした Client ID
   - **Client Secret (for OAuth)**: A-10 でコピーした Client Secret
   - **Skip nonce check**: OFF のまま（推奨）
   - **Authorized Client IDs**: 空でOK
4. ページ上部の **Save** をクリック

### D. 動作確認

1. https://app.aibazzlr.com にアクセス
2. ログアウト状態にして `/login` に遷移
3. 「Google でログイン」をクリック
4. Google 認証画面 → 自分のアカウント選択 → 「許可」
5. AIBazzlr にリダイレクトされ、ダッシュボードが表示される
6. Supabase Dashboard → Authentication → Users で新規ユーザーが作成されたことを確認

### E. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `redirect_uri_mismatch` | Authorized redirect URIs の入力ミス | Step A-8 を正確にコピペし直す |
| `access_denied` | OAuth consent screen の Test users に自分が登録されてない | Step B-10 で追加、または Publish app |
| `provider is not enabled` がまだ出る | Supabase 側で Enable トグルが OFF | Step C-2 を再確認 |
| `invalid_client` | Client ID / Secret の入力ミス | Step C-3 をコピペし直し |
| サインインは成功するが profiles に行が作られない | `handle_new_user` trigger が動いてない | Supabase SQL Editor で `select * from pg_trigger where tgname='on_auth_user_created';` を確認 |

## 完了後の確認チェックリスト

- [ ] Google Cloud Console で OAuth Client ID が作成されている
- [ ] OAuth consent screen で AIBazzlr アプリが登録されている
- [ ] Supabase で Google Provider が Enabled になっている
- [ ] Client ID と Client Secret が貼り付けられている
- [ ] https://app.aibazzlr.com でGoogle ログインが動作する
- [ ] 新規 Google ユーザーが `profiles` テーブルに自動作成される（trigger 動作確認）
- [ ] 新規 Google ユーザーが `plan='free'` で初期化されている
