# VegeEatEase — Claude Code 指示

**作業前に `README.md` を読むこと。**

## 絶対ルール

| ルール | 理由 |
|---|---|
| `web/` から Claude / Gemini API を直接呼ばない | APIキー漏洩防止 |
| APIキーを `web/` に置かない | 環境変数はサーバー側のみ |
| `safeat.js` は UI操作のみ記述する | ビジネスロジックをUIに混在させない |
| 認証ロジックは `web/auth.js` に分離する | safeat.js の肥大化防止 |

## 現在の画面構成（index.html内）

```
#landing-page       未ログイン時のランディングページ
#mode-select-page   初回ログイン時のモード選択
#scanner-page       スキャン画面（ログイン後）
#user-settings-page ユーザー設定ページ
```

showPage(page) 関数で切り替える。この関数は全ページをdisplay:noneにしてから指定ページだけ表示する。

## 認証フロー

```
ログイン → handleSession() → /api/user/settings を取得
  → mode_selected が false/未設定 → #mode-select-page
  → mode_selected が true → #scanner-page
```

## モード管理

- `MODE_DEFINITIONS` オブジェクトでモード別の表示内容を管理
- `applyModeDisplay(mode)` でスキャンページの表示を切り替え
- スキャンページでのモード切替はセッション中のみ（DBに保存しない）
- ユーザー設定ページでの変更は `PUT /api/user/settings` でDB保存

## 解析エンジン（固定）

- 画像解析: `POST /api/analyze/gemini/image/detailed`
- テキスト解析: `POST /api/analyze/gemini/text`
- `type: "image"` かつ `extractOnly` なしは廃止（400）

## キャッシュ

- 主キーは `(ingredient_hash, diet_mode)` の複合キー
- モードが違う成分は別エントリ

## ユーザー認証（実装済み）

- 無料プランは全モード合算で月10回まで
- tester・pro・business は無制限
- `scan_month`（YYYY-MM）で月替わり自動リセット
- 管理者リンクはユーザー設定ページ内に表示（ヘッダーには出さない）
- testerプランは現在9名に付与済み

## メール設定（✅ 完了）

- Resend + eatease.net ドメイン認証済み
- Sender email: noreply@eatease.net
- Supabase「Confirm email」: ON
- ※ daisho-kikaku.com のDNS設定は不要になった（eatease.netに移行済み）

## インフラ

- フロント: Cloudflare Pages（app.eatease.net）
- リポジトリ: GitHub Private（mahorobach/safeeat）
- API: Railway（safeeat-production-b7c5.up.railway.app）
- ALLOWED_ORIGINS: `https://app.eatease.net,https://mahorobach.github.io`

## 作業後チェックリスト

- [ ] `web/` にシークレットを置いていない
- [ ] 新ルート追加時は CORS・`server/index.js` のマウント確認
- [ ] 本番URL変更時は `web/site-config.js` と `ALLOWED_ORIGINS` の両方
- [ ] 認証ミドルウェアを通さないルートを作らない（`/api/health` 以外）
