# VegeEatEase 開発指示書【完全版】
## Claude Code + Gemini 2.5 Flash + Railway + Supabase + Cloudflare Pages

---

## 1. プロジェクト概要

**アプリ名：VegeEatEase**
**目的：** 食品の成分表を入力し、食事スタイル別に成分の安全性を判定するWebアプリ

### ターゲットユーザー
- オリエンタルベジタリアン（五葷抜き）を実践する人
- ゆるベジ・健康志向の日本人
- ヴィーガン・ハラール・アレルギー対応が必要な人（将来対応）
- 訪日外国人（台湾・東南アジア・中東）
- 宗教施設・ベジレストラン・ホテルなどの法人・職員

### 開発背景
- オーナーはRakuten Marketで菜食専門店「菜食健美」を2011年より運営
- 市場に菜食カテゴリを細かく分類できる成分チェックツールが少ない
- 自身の食事スタイル（乳・ローヤルゼリーはOK）を含む多様な菜食スタイルに対応したい

### サービス展開方針（2サービス）

```
app.eatease.net（VegeEatEase）
  → 全モード対応・将来課金・メイン事業
  → 新UIはPhase 5で設計

daisho-kikaku.com（菜食健美 成分チェッカー）
  → 現在のUIをそのまま流用
  → オリエンタルベジ専用・無料・Xserverに直置き
  → 菜食健美の既存顧客向け

バックエンド・Supabaseは両サービスで共用
  → ingredient_cacheが共通蓄積 → Gemini API費用削減
```

---

## 2. 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / JavaScript（静的） |
| バックエンド | Node.js / Express |
| データベース | Supabase（PostgreSQL） |
| 認証 | Supabase Auth（メール＋パスワード） |
| AI解析（メイン） | **Gemini 2.5 Flash**（OCR＋判定 1ステップ） |
| AI解析（予備） | Claude API `claude-sonnet-4-6`系（テキスト判定・`/api/analyze`） |
| キャッシュ | Supabase `ingredient_cache` テーブル（SHA-256ハッシュ・モード別複合キー） |
| APIホスティング | **Railway**（本番） |
| フロントホスティング | **Cloudflare Pages**（app.eatease.net） |
| メール送信 | **Resend**（noreply@eatease.net・認証済み） |
| ドメイン | **Cloudflare**（eatease.net・約$10/年） |
| ソース管理 | GitHub（**プライベート**） |
| 決済（将来） | Stripe |

---

## 3. 判定ルール（オリエンタルベジタリアン確定版）

### ❌ NG
| 成分 | 理由 |
|---|---|
| 肉類全般（牛・豚・鶏等） | 動物性 |
| 魚介類全般 | 動物性 |
| 五葷（ニンニク・ネギ・ニラ・らっきょう・玉ねぎ） | 加工品・エキス・パウダーも同様 |
| コチニール色素（E120） | カイガラムシ（虫）由来 |
| コラーゲン | 動物由来 |
| ゼラチン | 動物由来 |
| シェラック | ラックカイガラムシ（虫）由来 |

### ✅ OK
| 成分 | 理由 |
|---|---|
| 卵・卵黄・卵黄レシチン | オリエンタルベジタリアンは卵OK |
| 乳製品全般・カゼイン | 乳製品はOK |
| 蜂蜜・ローヤルゼリー | OK |
| 大豆レシチン | 植物性 |
| ビタミンD（ラノリン・羊毛由来） | 羊毛由来はOK |
| 乳酸 | OK（とりあえず許容） |
| 植物性油脂全般 | 植物性 |
| アサフェティダ | 五葷の代替スパイス |

### 🟡 グレー（由来要確認）
| 成分 | 理由 |
|---|---|
| グリセリン | 植物性ならOK／動物性油脂由来ならNG |
| 香料（天然） | 植物性OK／動物性ムスク等含む可能性あり |
| 酵素 | 微生物・植物性OK／動物性はNG |
| ビタミンD（由来不明） | キノコ由来OK／由来不明の場合はグレー |

---

## 4. フォルダ構成

```
VegeEatEase/（リポジトリ名: safeeat）
├── web/
│   ├── index.html
│   ├── site-config.js            # API_BASE・SUPABASE_URL・SUPABASE_ANON_KEY
│   ├── safeat.js                 # UI操作のみ
│   ├── safeat-api.js             # API クライアント
│   ├── auth.js                   # Supabase Auth クライアント（window.SafeEatAuth）
│   ├── safeat.css
│   ├── admin.html                # 管理者ページ
│   ├── privacy.html              # プライバシーポリシー
│   ├── terms.html                # 利用規約
│   └── lib/
│       ├── ingredients-db.js
│       └── rules.js
├── server/
│   ├── index.js
│   ├── package.json
│   ├── routes/
│   │   ├── analyze.js            # Claude予備エンジン
│   │   ├── analyze-gemini.js     # Geminiメインエンジン
│   │   ├── ingredients.js        # 成分DB参照
│   │   ├── user.js               # 認証・スキャン回数・設定管理
│   │   ├── admin.js              # 管理者機能（ユーザー一覧・プラン変更）
│   │   ├── product.js            # バーコード商品検索・マイリスト・カタログ
│   │   └── subscription.js       # サブスクリプション管理（Stripe将来対応）
│   ├── middleware/auth.js
│   └── supabase/
│       ├── client.js
│       └── schema.sql
├── shared/
│   ├── ingredients-db.json
│   └── rules.js
└── ...
```

---

## 5. アーキテクチャ方針

### 基本構造：3層レイヤードアーキテクチャ

```
UI層（web/safeat.js）
  ↓ 表示・操作のみ。AI APIを直接呼ばない
ビジネスロジック層（shared/rules.js）
  ↓ 判定ルール一元管理。UIにもDBにも依存しない
データ層（server/routes / Supabase）
  外部サービスとの通信のみ。判定ロジックを書かない
```

### 絶対ルール

| ルール | 理由 |
|---|---|
| UI層からAI APIを直接呼ばない | APIキー漏洩防止 |
| APIキーを `web/` に置かない | 環境変数はサーバー側のみ |
| 認証ロジックは `web/auth.js` に分離 | safeat.js の肥大化防止 |
| 判定ロジックは `shared/rules.js` に一元管理 | Web・モバイル全フェーズで共通利用 |
| web/lib/rules.js・ingredients-db.jsは削除済み | 判定ロジックはすべてサーバーサイド（shared/rules.js）に集約。localFallback()も削除済み |

---

## 6. マイリスト・カタログ設計（Phase 3.9 完了）

### テーブル設計

```sql
-- 個人マイリスト
saved_products (
  id, user_id, product_name, jan_code, diet_mode,
  ingredient_text, is_safe, image_url, shop_url, amazon_url, created_at
)

-- 共有カタログ（匿名・JANコードありのみ）
product_catalog (
  id, product_name, jan_code, diet_mode,
  ingredient_text, is_safe, image_url, shop_url, amazon_url,
  scan_count, first_scanned_at, last_scanned_at,
  UNIQUE (jan_code, diet_mode)
)
```

### バーコードスキャンページ（2種類）

- `save-barcode-page`：成分解析後の登録用
- `mylist-add-page`：マイリストからの直接追加用
- 両者は独立しており相互に影響しない

### 商品名の取得優先順位

1. バーコードスキャン → 楽天API → Open Food Facts
2. 成分表画像 → GeminiがDETAILED_IMAGE_PROMPTで抽出（product_name）
3. どちらも取れなかった → 空欄（手動入力）

### 登録フロー

```
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

### 保存完了後の遷移

- `save-barcode-page`：scanner-pageに戻りmylist-saved-messageを表示
- `mylist-add-page`：mylist-pageに戻りloadMyList()を実行

mylist-saved-messageの表示順（scanner-page内）：
1. ✅ マイリストに保存しました
2. 📦 マイリストはこちら（茶色・btn-goto-mylist）
3. 🛒 Amazonで購入（オレンジ・btn-amazon-after-save）
4. 新しい食品を解析する
5. 判定結果にフィードバックを送る

### モード別データ管理（A案）
- 同じ商品でもモードが違えば別行
- `WHERE diet_mode='vegan' AND is_safe=true` で一発検索可能

### 重要な実装上の注意
- `renderDetailedResult()` は Gemini詳細モード専用の描画関数で `renderResult()` を経由しない
- `showSaveButtonIfSafe()` は**両方の関数末尾**で呼ぶこと
- 解析開始時に `save-to-mylist-area` を非表示・`window._lastAnalysisResult` をリセットすること
- JSを修正したら `safeat.js?v=x.x.x` のバージョン番号を上げること（Cloudflareキャッシュ対策）



## 7. ユーザー認証（Phase 3 完了）

### 認証フロー

```
新規登録（メール＋パスワード）
  → Supabase Auth
  → on_auth_user_created トリガーで user_profiles を自動生成
  → JWTトークンを localStorage に保存
  → API呼び出し時に Authorization: Bearer <token> を付与
  → server/middleware/auth.js で検証
```

### 利用回数の設計思想

- **全モード合算で月10回**（シンプルさ優先）
- `scan_month`（YYYY-MM）と現在月を比較し、月替わりで自動リセット
- `scan_logs` にモード別ログを保存（将来の分析・課金設計のため）

---

## 8. 環境変数一覧

| 変数 | 必須 | 説明 |
|------|------|------|
| `GEMINI_API_KEY` | **はい** | Google AI Studio（ブラウザに出さない） |
| `GEMINI_MODEL` | 推奨 | 例: `gemini-2.5-flash` |
| `SUPABASE_URL` | **はい** | SupabaseプロジェクトURL |
| `SUPABASE_ANON_KEY` | 認証用 | 公開キー（web/site-config.jsにも設定） |
| `SUPABASE_SERVICE_ROLE_KEY` | **はい** | サービスロール（秘匿・サーバーのみ） |
| `CLAUDE_API_KEY` | Claude利用時 | Anthropic APIキー（現在は予備） |
| `STRIPE_SECRET_KEY` | 課金時 | Stripeシークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Webhook時 | Stripe署名検証用 |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS許可オリジン（末尾スラッシュなし） |
| `PORT` | 任意 | 未設定時は3000 |
| `RAKUTEN_AFFILIATE_ID` | アフィリエイト時 | 楽天アフィリエイトID |

現在の ALLOWED_ORIGINS: `https://app.eatease.net,https://mahorobach.github.io`

---

## 9. 開発フェーズロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コア実証（写真→抽出→編集→判定） | **完了** |
| 2 | Gemini 1ステップ解析 + Supabaseキャッシュ | **完了** |
| 3 | ユーザー認証（Supabase Auth）・月10回制限・管理者ページ | **完了** |
| 3.5 | ランディングページ・モード選択・法的ページ | **完了** |
| 3.6 | メール設定（Resend・eatease.net認証） | **✅ 完了** |
| 3.7 | インフラ整備（Cloudflare Pages・ドメイン取得・GitHub Private化） | **✅ 完了** |
| 3.8 | バーコードスキャン → 楽天・Amazonリンク | **✅ 完了** |
| 3.9 | 判定OK後マイリスト登録 + カタログデータ蓄積 | **✅ 完了** |
| 4 | テストユーザーフィードバック収集（9名）・楽天Amazonアフィリエイト実装 | **← 現在** |
| 5 | UIデザイン改善・集客 | 次 |
| 6 | サブスク課金（Stripe）・プラン管理 | ユーザー数を見て判断 |
| 7 | グレー確認フロー（有料プランの核心） | 有料プランの核心機能 |
| 8 | マイリスト画面・カタログ検索画面 | 次フェーズ候補 |
| 9 | iOSアプリ化（SwiftUI）※バーコード実装時 | App Store申請の前提 |
| 10 | App Store申請・リリース | 最終ゴール |
| 11 | Android対応 | 将来 |

### 収益方針

**まずユーザーを集めることを最優先。** 課金設計はユーザーが一定数集まってから判断する。

---

## 10. コード肥大化への方針

2026-05-12時点で `web/safeat.js` は約2378行、`web/index.html` は約698行、`web/safeat.css` は約2092行まで大きくなっている。

この状態で「機能追加を続け、最後にまとめて全体修正する」方針は避ける。認証、画面遷移、カメラ、バーコード、Gemini解析、マイリスト保存が相互に絡んでいるため、最後に一括で直すと影響範囲が広くなり、不具合の原因特定も難しくなる。

今後は全面リライトではなく、動く状態を保ったまま段階的に整理する。新機能追加やバグ修正で触る周辺から、既存挙動を変えない範囲で小さく分割する。

優先して分離を検討する領域:

- `auth.js`: 認証フロー、セッション、ログイン状態表示
- `api-client.js`: API呼び出し、認証トークン付きfetch
- `pages.js`: `showById()` などの画面遷移
- `scanner.js`: カメラ、バーコードスキャン、停止処理
- `mylist.js`: 保存、一覧、削除、商品名表示
- `result-renderer.js`: `renderResult()`、`renderDetailedResult()`、保存ボタン表示

基本方針は「今すぐ全体を作り直す」でも「最後に全部直す」でもなく、次の修正から触る場所を少しずつ分割すること。JS/CSSを修正した場合は、従来どおり `index.html` の `safeat.js?v=x.x.x` / `safeat.css?v=x.x.x` を更新する。

---

## 11. ローカル確認URL

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

---

## 12. ハマりポイント・トラブルシュート

| # | 問題 | 原因 | 解決策 |
|---|---|---|---|
| 1〜14 | Gemini・デプロイ系 | README.md参照 | README.md参照 |
| 15 | Email not confirmed | 確認メールのリンク未クリック | Dashboard → Auth → URL Configuration確認 |
| 16 | Email rate limit exceeded | Supabase無料プランは1時間4通制限 | 開発中はConfirm emailをOFF・本番は外部SMTP |
| 17 | 残り回数が「？」・500エラー | `user_profiles` テーブルが未作成 | Supabase SQL EditorでCREATE TABLE実行 |
| 18 | 既存ユーザーにプロファイルがない | トリガー設定前に登録したユーザー | `INSERT INTO user_profiles SELECT id FROM auth.users ON CONFLICT DO NOTHING` |
| 19 | 管理リンクが複数表示 | onAuthStateChangeが複数回発火 | ユーザー設定ページ内に管理リンクを移動 |
| 20 | user_settings テーブルがない | 未作成 | SQL EditorでCREATE TABLE実行 |
| 21 | 登録ボタンが表示されない | `renderDetailedResult()` が `renderResult()` を経由せず独自描画 | `renderDetailedResult()` 末尾に `showSaveButtonIfSafe()` を追加 |
| 22 | 解析前にconfirmダイアログが出る | 前回のgray判定結果が残った状態で新しい解析を開始 | 解析開始時に `save-to-mylist-area` を非表示・`_lastAnalysisResult` をリセット |
| 23 | 古いJSが配信される | Cloudflare キャッシュ | `safeat.js?v=x.x.x` のバージョン番号を上げる |
| 24 | SQL EditorにペーストできないSupabase問題 | ブラウザのフォーカス問題 | エディタを一度クリックしてからペースト or 右クリック→貼り付け |
| 25 | 楽天APIで商品名が取得できない | 楽天に未登録の商品 | Open Food Facts APIにフォールバック |
| 26 | 楽天リンクがアフィリエイトにならない | itemUrlをそのまま使用 | RAKUTEN_AFFILIATE_IDで変換 |
| 27 | バーコードスキャンが遅い | showById()内で_stopBarcodeScanner()が呼ばれカメラ起動前に干渉 | バーコードページへの遷移はshowById()を使わず_ALL_PAGES.forEachで直接切替 |
| 28 | ドロワーメニューを閉じずにページ遷移 | closeDrawer()がIIFE外から呼べなかった | window.closeDrawerとして公開 |
| 29 | スマホでCSSのdisplay:noneが効かない | メディアクエリより後にdisplay:flexが定義されていた | 対象クラス定義の直後に!importantで上書き |
| 30 | 商品名が取得できない | DETAILED_IMAGE_PROMPTにproduct_name指示がなかった | DETAILED_IMAGE_PROMPTのJSON出力形式にproduct_nameフィールドを追加し、res.jsonにも含める |
| 31 | safeat-api.jsでproduct_nameが捨てられる | analyzeImageWithGeminiDetailedの返却値にproduct_nameが含まれていなかった | return文に product_name: data.product_name ?? null を追加 |

---

## 13. 重要URL

| 項目 | URL |
|---|---|
| フロントエンド | https://app.eatease.net |
| 管理者ページ | https://app.eatease.net/admin.html |
| APIサーバー | https://safeeat-production-b7c5.up.railway.app |
| API死活確認 | https://safeeat-production-b7c5.up.railway.app/api/health |
| GitHubリポジトリ | https://github.com/mahorobach/safeeat（プライベート） |

---

## 14. サービス別アカウントメモ

| サービス | 備考 |
|---|---|
| Cloudflare | Dokakao@gmail.com / ドメイン: eatease.net / Pages: safeeat（app.eatease.net） |
| Railway | プロジェクト: safeeat |
| Supabase | Confirm email: ON / Sender: noreply@eatease.net / Site URL: https://app.eatease.net |
| Resend | ドメイン: eatease.net（認証済み） |
| GitHub | mahorobach/safeeat（プライベート） |

---

*作成日：2026年4月28日*
*最終更新：2026年5月12日（ローカル確認URLを http://localhost:5500/index.html に統一）*
