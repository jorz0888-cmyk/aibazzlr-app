# Supabase Email テンプレート — AIBazzlr 日本語化

5つの認証メールテンプレートを AIBazzlr ブランドに合わせて差し替えるための手順書。

## なぜ手動更新か

Supabase MCP には Auth Config（メールテンプレート）を更新する API は含まれていません。
プログラム経由で更新するには Supabase Management API + Personal Access Token が必要です（次節「自動化したい場合」参照）。
1回きりの更新であれば Dashboard が最速です。

## 更新手順（共通）

1. https://supabase.com/dashboard/project/squxuzfpdugpjjgnryoe/auth/templates を開く
2. 左サイドバーの **Authentication → Email Templates** に移動
3. 下の5つのテンプレートを順に開いて、Subject と Message body をそれぞれ差し替え
4. 各テンプレートの右上 **Save** を押す（テンプレートごとに保存が必要）

各テンプレートのプレースホルダー `{{ .ConfirmationURL }}` は Supabase が自動で正しい URL に置換するのでそのまま残してください。

---

## A. Confirm signup（登録確認）

**Subject:**
```
【AIBazzlr】メールアドレスの確認をお願いします
```

**Message body (HTML):**
```html
<h2>AIBazzlr へようこそ！</h2>

<p>この度は AIBazzlr にご登録いただきありがとうございます。</p>
<p>下記のボタンをクリックして、メールアドレスの確認を完了してください。</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="background-color: #00d4ff; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
    メールアドレスを確認する
  </a>
</p>

<p>ボタンが機能しない場合は、以下の URL をブラウザに貼り付けてください:</p>
<p>{{ .ConfirmationURL }}</p>

<hr>

<p style="color: #666; font-size: 12px;">
  このメールは AIBazzlr にご登録された方にお送りしています。<br>
  心当たりがない場合は、このメールを無視してください。
</p>

<p style="color: #666; font-size: 12px;">
  AIBazzlr - SNS自動投稿サービス<br>
  運営: J's Pay<br>
  <a href="https://aibazzlr.com">aibazzlr.com</a>
</p>
```

---

## B. Reset password（パスワードリセット）

**Subject:**
```
【AIBazzlr】パスワードリセットのご案内
```

**Message body (HTML):**
```html
<h2>パスワードリセット</h2>

<p>AIBazzlr のパスワードリセットリクエストを受け付けました。</p>
<p>下記のボタンをクリックして、新しいパスワードを設定してください。</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="background-color: #00d4ff; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
    新しいパスワードを設定する
  </a>
</p>

<p>このリンクは24時間有効です。</p>
<p>心当たりがない場合は、このメールを無視してください。アカウントは安全に保護されています。</p>

<hr>

<p style="color: #666; font-size: 12px;">
  AIBazzlr - SNS自動投稿サービス<br>
  運営: J's Pay<br>
  <a href="https://aibazzlr.com">aibazzlr.com</a>
</p>
```

---

## C. Magic Link（マジックリンク）

**Subject:**
```
【AIBazzlr】ログインリンク
```

**Message body (HTML):**
```html
<h2>AIBazzlr ログイン</h2>

<p>下記のボタンをクリックして、AIBazzlr にログインしてください。</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="background-color: #00d4ff; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
    AIBazzlr にログインする
  </a>
</p>

<p>このリンクは1時間有効です。一度のみ使用可能です。</p>
<p>心当たりがない場合は、このメールを無視してください。</p>

<hr>

<p style="color: #666; font-size: 12px;">
  AIBazzlr - SNS自動投稿サービス<br>
  運営: J's Pay<br>
  <a href="https://aibazzlr.com">aibazzlr.com</a>
</p>
```

---

## D. Change email address（メアド変更）

**Subject:**
```
【AIBazzlr】メールアドレス変更の確認
```

**Message body (HTML):**
```html
<h2>メールアドレス変更の確認</h2>

<p>AIBazzlr のメールアドレス変更リクエストを受け付けました。</p>
<p>下記のボタンをクリックして、変更を完了してください。</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="background-color: #00d4ff; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
    メールアドレスを変更する
  </a>
</p>

<p>心当たりがない場合は、すぐに既存のメールアドレスでパスワードを変更し、サポートまでご連絡ください。</p>

<hr>

<p style="color: #666; font-size: 12px;">
  AIBazzlr - SNS自動投稿サービス<br>
  運営: J's Pay<br>
  <a href="https://aibazzlr.com">aibazzlr.com</a>
</p>
```

---

## E. Invite user（招待）

**Subject:**
```
【AIBazzlr】招待が届きました
```

**Message body (HTML):**
```html
<h2>AIBazzlr への招待</h2>

<p>AIBazzlr にご招待いただきました。</p>
<p>下記のボタンをクリックして、アカウント登録を完了してください。</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="background-color: #00d4ff; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
    アカウントを作成する
  </a>
</p>

<hr>

<p style="color: #666; font-size: 12px;">
  AIBazzlr - SNS自動投稿サービス<br>
  運営: J's Pay<br>
  <a href="https://aibazzlr.com">aibazzlr.com</a>
</p>
```

---

## 自動化したい場合（Management API）

将来同様の変更を CI / コードからやりたいなら、Supabase Management API の `PATCH /v1/projects/{ref}/config/auth` で `mailer_subjects_*` と `mailer_templates_*` を更新できます。

```bash
# Personal Access Token を https://supabase.com/dashboard/account/tokens から発行
export SUPABASE_PAT=sbp_xxx
curl -X PATCH \
  https://api.supabase.com/v1/projects/squxuzfpdugpjjgnryoe/config/auth \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_subjects_confirmation": "【AIBazzlr】メールアドレスの確認をお願いします",
    "mailer_templates_confirmation_content": "<h2>...</h2>"
  }'
```

`mailer_subjects_*` / `mailer_templates_*_content` のキー名は Supabase のドキュメント参照: <https://supabase.com/docs/reference/api/v1-update-a-project-s-auth-config>

## 動作確認

更新後の確認手順:
1. AIBazzlr で新規メールでサインアップ → 確認メールが届くことを確認
2. 件名が `【AIBazzlr】メールアドレスの確認をお願いします` になっていること
3. 本文に AIBazzlr のブランディング（シアン色のボタン）が表示されること
4. ボタンをクリックして実際に確認フローが完了すること

問題があれば Supabase Dashboard → Authentication → Logs で `mailer` 関連のエラーを確認。
