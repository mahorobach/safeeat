# SafeEat — Claude Code 指示

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
#landing-page      未ログイン時のランディングページ
#mode-select-page  初回ログイン時のモード選択
#scanner-page      スキャン画面（ログイン後）
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

## メール設定（未完了）

- 現在「Confirm email」はOFF
- Resendの `daisho-kikaku.com` DNS設定が完了したらONに戻す
- 本番前に必ず対応すること

## 作業後チェックリスト

- [ ] `web/` にシークレットを置いていない
- [ ] 新ルート追加時は CORS・`server/index.js` のマウント確認
- [ ] 本番URL変更時は `web/site-config.js` と `ALLOWED_ORIGINS` の両方
- [ ] 認証ミドルウェアを通さないルートを作らない（`/api/health` 以外）
- [ ] **本番リリース前に Supabase の「Confirm email」をONに戻す**
- [ ] **本番リリース前にDNS設定・Resendドメイン認証を完了する**
