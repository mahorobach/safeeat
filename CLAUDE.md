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
#mylist-page        マイリスト一覧ページ
#save-barcode-page  マイリスト登録用バーコードスキャンページ
#mylist-add-page    マイリストへの商品追加スキャンページ
```

- 認証フロー内では `showPage(page)` で切り替える（IIFE内専用）
- 一般的な画面遷移は `showById(id)` を使う（`_ALL_PAGES` 全体を非表示にしてから指定ページだけ表示）
- バーコードスキャナー起動前の遷移は `showById()` を使わず `_ALL_PAGES.forEach` で直接切替すること

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

## インフラ

- フロント: Cloudflare Pages（app.eatease.net / veg.eatease.net）
- リポジトリ: GitHub Private（mahorobach/safeeat）
- API: Railway（safeeat-production-b7c5.up.railway.app）
- ALLOWED_ORIGINS: `https://app.eatease.net,https://mahorobach.github.io`

## マイリスト・カタログ設計（Phase 3.9 完了）

### テーブル
```
saved_products     → 個人マイリスト（user_id あり・削除自由）
product_catalog    → 共有カタログ（user_id なし・匿名・JANコードありのみ）
```

### 登録フロー
```

【商品名の取得優先順位】
1. バーコードスキャン → 楽天API → Open Food Facts
2. 成分表画像 → GeminiがDETAILED_IMAGE_PROMPTで抽出（product_name）
3. どちらも取れなかった → 空欄（手動入力）

【登録フロー】
判定結果「✅ 安全」or「🟡 グレー」
  ↓
「📷 バーコードを読み取り、保存」ボタン
「📝 バーコードなしで保存」ボタン（インライン入力欄が展開）
  ↓ バーコードスキャン成功時
scanner-pageに戻り、商品名入力欄を表示
  ┌─ 楽天/Open Food Factsで名前取得できた → 入力欄に初期値
  └─ 取得できなかった → Geminiが抽出したproduct_nameをフォールバック
  ↓ 「保存する」ボタンを押す
保存完了（✅ マイリストに保存しました）

「新しい食品を解析する」ボタンを押すと
_lastScannedProduct・_lastExtractedProductName・入力欄をリセット
```


### 判定結果別ボタン表示
```
overall='ok'   → 登録ボタン表示
overall='gray' → 注記付きで登録ボタン表示（window.confirm は使わない）
overall='ng'   → 登録ボタン非表示
```

### 重要：renderDetailedResult() に注意
- Gemini詳細モードは `renderResult()` を経由せず `renderDetailedResult()` で独自描画
- `showSaveButtonIfSafe()` は両方の関数末尾で呼ぶこと

### JSバージョン管理
- JSを修正したら `index.html` の `safeat.js?v=x.x.x` のバージョン番号を上げること
- CSSを修正したら `index.html` の `safeat.css?v=x.x.x` のバージョン番号を上げること
- Cloudflare Pages のキャッシュが古いJS/CSSを返す問題を防ぐため

### 商品名が取得できない場合の表示
- product_name が null の場合は `JAN: XXXXXXXXX` を表示
- loadMyList() の displayName で制御

### アフィリエイトリンク
- 楽天: RAKUTEN_AFFILIATE_ID（Railway環境変数）でURL変換
- Amazon: `https://www.amazon.co.jp/s?k=${jan_code}&i=grocery&tag=vegeatease-22`
- バーコードスキャン成功後の画面に表示（スキャン画面内・画面遷移なし）

### ログイン状態の維持
- sessionStorage → localStorage に変更済み

## ページ遷移の注意
- カメラ起動・停止は必ず await で完了を待つこと

## スコープの注意
- closeDrawer() / loadMyList() / openSaveBarcodePage() は
  IIFE内定義のため、外部から呼ぶ場合は window.xxx で公開すること

## CSS注意
- メディアクエリのdisplay:noneが効かない場合は !important を使うか
  対象クラス定義の直後にメディアクエリを書くこと

## 実装前の必須確認
- 実装前に関連する既存コードの構造（親要素・スコープ・非同期）を
  必ず確認してから実装すること

## コード肥大化への方針

2026-05-12時点で `web/safeat.js` は約2378行、`web/index.html` は約698行、`web/safeat.css` は約2092行まで大きくなっている。

この状態で「機能追加を続け、最後にまとめて全体修正する」方針は避けること。認証、画面遷移、カメラ、バーコード、Gemini解析、マイリスト保存が相互に絡んでいるため、最後に一括で直すと影響範囲が広くなり、不具合の原因特定も難しくなる。

今後は全面リライトではなく、動く状態を保ったまま段階的に整理する。新機能追加やバグ修正で触る周辺から、既存挙動を変えない範囲で小さく分割する。

優先して分離を検討する領域:

- `auth.js`: 認証フロー、セッション、ログイン状態表示
- `api-client.js`: API呼び出し、認証トークン付きfetch
- `pages.js`: `showById()` などの画面遷移
- `scanner.js`: カメラ、バーコードスキャン、停止処理
- `mylist.js`: 保存、一覧、削除、商品名表示
- `result-renderer.js`: `renderResult()`、`renderDetailedResult()`、保存ボタン表示

基本方針は「今すぐ全体を作り直す」でも「最後に全部直す」でもなく、次の修正から触る場所を少しずつ分割すること。JS/CSSを修正した場合は、従来どおり `index.html` の `safeat.js?v=x.x.x` / `safeat.css?v=x.x.x` を更新する。

## ローカル確認URL

ローカルでフロントを確認するときは、開くURLを必ず次に統一する。

```text
http://localhost:5500/index.html
```

`file://.../index.html` ではログイン、CORS、カメラ権限が正しく確認できないため使わない。`127.0.0.1:5500` も表記ゆれを避けるため通常は使わない。

起動コマンド:

```bash
cd web
python3 -m http.server 5500
```
  
  
## Claude Chatとの連携

- 設計相談・バグ調査はClaude Chatを活用する
- Claude Chatは必ずファイルを確認してから判断する
  → 問題が解決しない場合は、修正後の最新ファイルをアップロードして再確認を依頼する
- 確認が必要な主なファイル：
  - フロント修正時：index.html・safeat.js・safeat.css
  - API修正時：analyze-gemini.js・safeat-api.js
  - ロジック修正時：shared/rules.js・server/routes/該当ファイル
- Claude Chatでの変更内容は、セッション終了時に.mdファイルへ反映する

## 作業後チェックリスト

- [ ] `web/` にシークレットを置いていない
- [ ] 新ルート追加時は CORS・`server/index.js` のマウント確認
- [ ] 本番URL変更時は `web/site-config.js` と `ALLOWED_ORIGINS` の両方
- [ ] 認証ミドルウェアを通さないルートを作らない（`/api/health` 以外）
- [ ] JSを修正したら `safeat.js?v=x.x.x` のバージョン番号を上げる（キャッシュ対策）
