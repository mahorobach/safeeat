# VegeEatEase — 食品成分チェッカー

食品の成分表を入力し、食事スタイル別に成分の安全性を判定するWebアプリ。

---

## ターゲットユーザー

- オリエンタルベジタリアン（五葷抜き）を実践する人
- ゆるベジ・健康志向の日本人
- ヴィーガン・ハラール・アレルギー対応が必要な人（将来対応）
- 訪日外国人（台湾・東南アジア・中東）
- 宗教施設・ベジレストラン・ホテルなどの法人・職員

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / JavaScript（静的） |
| バックエンド | Node.js / Express |
| データベース | Supabase（PostgreSQL） |
| 認証 | Supabase Auth（メール＋パスワード） |
| AI解析（現在） | **Gemini 2.5 Flash**（OCR + 判定 1ステップ） |
| AI解析（Claude・予備） | `claude-sonnet-4-6` 系 |
| キャッシュ | Supabase `ingredient_cache`（SHA-256・モード別複合キー） |
| メール送信 | Resend（noreply@eatease.net・認証済み） |
| フロントホスティング | Cloudflare Pages |
| APIホスティング | Railway |
| ソース管理 | GitHub（プライベート） |
| 決済（将来） | Stripe |

---

## 重要URL

| 項目 | URL |
|---|---|
| フロントエンド（VegeEatEase） | https://app.eatease.net |
| フロントエンド（菜食健美チェッカー） | https://daisho-kikaku.com（将来） |
| APIサーバー | https://safeeat-production-b7c5.up.railway.app |
| API死活確認 | https://safeeat-production-b7c5.up.railway.app/api/health |
| GitHubリポジトリ | https://github.com/mahorobach/safeeat |
| 管理者ページ | https://app.eatease.net/admin.html |

---

## サービス展開方針（2サービス）

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

## ページ構成

| ページ | ファイル | 説明 |
|---|---|---|
| ランディング | `web/index.html` | 未ログイン時のトップページ |
| モード選択 | `web/index.html` | 初回ログイン時のみ表示 |
| スキャンページ | `web/index.html` | ログイン後の解析画面 |
| ユーザー設定 | `web/index.html` | デフォルトモード変更・残り回数確認 |
| 管理者ページ | `web/admin.html` | ユーザー管理・プラン変更 |
| プライバシーポリシー | `web/privacy.html` | 法的ページ |
| 利用規約 | `web/terms.html` | 法的ページ |

### フロント分離状況（2026-05-12）

肥大化防止のため、`web/index.html` / `web/safeat.js` / `web/safeat.css` から段階的に分離済み。

| 領域 | 主なファイル |
|---|---|
| 起動・共通DOM | `web/safeat.js` |
| APIクライアント | `web/safeat-api.js` |
| 認証UI | `web/auth-ui.js`, `web/auth-modal.css` |
| 画面遷移 | `web/page-utils.js`, `web/navigation-ui.js` |
| モード表示 | `web/mode-ui.js` |
| ユーザー設定 | `web/settings-ui.js` |
| 画像・カメラ | `web/image-ui.js` |
| 解析制御 | `web/analysis-controller.js` |
| 判定結果 | `web/result-ui.js` |
| マイリスト | `web/mylist-ui.js`, `web/user-mylist.css` |
| LP・モード選択CSS | `web/landing.css` |
| 管理者画面 | `web/admin.html`, `web/admin.js`, `web/admin.css` |

CSSは `safeat.css` が共通・スキャン・結果・カメラ系、追加CSSが各画面領域を担当する。これ以上の細分化は必要になった場合のみ行う。

---

## 画面遷移フロー

```
未ログイン → ランディングページ
  ↓ 登録・ログイン
初回のみ → モード選択画面
  ↓ モード選択・保存（user_settings.mode_selected = true）
スキャンページ（モードバーで一時切替可能・DBは変わらない）
  ↓
ユーザー設定ページ（デフォルトモード永続変更・残り回数確認・ログアウト）
```

---

## ユーザー認証（Phase 3 完了）

### プラン別制限

| プラン | スキャン回数 | 対象 |
|---|---|---|
| `free` | 月10回（全モード合算） | 一般ユーザー |
| `tester` | 無制限 | 管理者が付与したテストユーザー（現在9名） |
| `pro` | 無制限 | 将来の有料ユーザー |
| `business` | 無制限 | 将来の法人ユーザー |

### Supabaseテーブル（実装済み）

```sql
user_profiles    (id, plan, scan_count, scan_month, created_at, updated_at)
scan_logs        (id, user_id, diet_mode, created_at)
user_settings    (user_id, mode, mode_selected, custom_ng, custom_ok, updated_at)
ingredient_cache (ingredient_hash, diet_mode, ingredient_text, analysis_result, hit_count, created_at)
saved_products   (id, user_id, product_name, jan_code, diet_mode, ingredient_text, is_safe, image_url, shop_url, amazon_url, created_at)
product_catalog  (id, product_name, jan_code, diet_mode, ingredient_text, is_safe, image_url, shop_url, amazon_url, scan_count, first_scanned_at, last_scanned_at)
```

### マイリスト・カタログ設計

```
saved_products（個人マイリスト）
  → user_id あり・削除自由

product_catalog（共有カタログ）
  → user_id なし・匿名
  → JANコードありのデータのみ登録
  → jan_code + diet_mode でユニーク・scan_count をインクリメント
  → ユーザーが削除してもカタログからは消えない
```

### APIエンドポイント（実装済み）

```
GET  /api/user/me                      → ユーザー情報・残り回数
GET  /api/user/scan-count              → 残り回数（未ログインも可）
POST /api/user/scan-count/increment    → 回数+1・月替わりで自動リセット
GET  /api/user/profile                 → プロファイル取得
GET  /api/user/settings                → 設定取得
PUT  /api/user/settings                → 設定保存（mode・mode_selected）
POST /api/user/analysis                → 分析ログ保存
GET  /api/admin/check                  → 管理者チェック
GET  /api/admin/stats                  → 統計情報
GET  /api/admin/users                  → ユーザー一覧
PUT  /api/admin/users/:userId/plan     → プラン変更
GET  /api/product/lookup               → バーコード商品情報検索（楽天API → Open Food Factsにフォールバック）
POST /api/product/save                 → マイリスト保存（+ product_catalog upsert）
GET  /api/product/mylist               → マイリスト取得
DELETE /api/product/mylist/:id         → マイリスト削除
GET  /api/subscription/status          → サブスク状態確認
POST /api/subscription/cancel          → サブスク解約
POST /api/analyze/gemini/image/detailed → 成分詳細判定（product_name・成分BBox・vege_status返却）
```

---

## モード定義（実装済み）

| モード | キー | 説明 |
|---|---|---|
| オリエンタルベジタリアン | `oriental` | 五葷・肉・魚NG。卵・乳製品・蜂蜜OK |
| ヴィーガン | `vegan` | すべての動物由来成分NG |
| ラクト・オボ | `lacto_ovo` | 肉・魚のみNG |
| カスタム | `custom` | 有料プラン・近日公開 |

---

## メール送信設定（✅ 完了）

| 項目 | 状態 |
|---|---|
| Resendアカウント作成 | ✅ 完了 |
| APIキー作成 | ✅ 完了 |
| Supabase SMTP設定 | ✅ 完了 |
| `eatease.net` ドメイン認証 | ✅ 完了（Cloudflare Auto configure） |
| Sender email | ✅ noreply@eatease.net |
| Confirm email | ✅ ON |

---

## 環境変数一覧（Railway）

| 変数 | 必須 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | **はい** | Google AI Studio |
| `GEMINI_MODEL` | 推奨 | 例: `gemini-2.5-flash` |
| `SUPABASE_URL` | **はい** | SupabaseプロジェクトURL |
| `SUPABASE_ANON_KEY` | 認証用 | 公開キー（web/site-config.jsにも設定） |
| `SUPABASE_SERVICE_ROLE_KEY` | **はい** | サービスロール（秘匿） |
| `ADMIN_EMAIL` | **はい** | 管理者メールアドレス |
| `CLAUDE_API_KEY` | 予備 | Anthropic APIキー |
| `STRIPE_SECRET_KEY` | 課金時 | Stripeシークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Webhook時 | Stripe署名検証用 |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS許可オリジン |
| `PORT` | 任意 | 未設定時は3000 |
| `RAKUTEN_AFFILIATE_ID` | アフィリエイト時 | 楽天アフィリエイトID |

---

## 開発フェーズロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コア実証（写真→抽出→編集→判定） | **完了** |
| 2 | Gemini 1ステップ解析 + Supabaseキャッシュ | **完了** |
| 3 | ユーザー認証・月10回制限・管理者ページ | **完了** |
| 3.5 | ランディングページ・モード選択・法的ページ | **完了** |
| 3.6 | メール設定（Resend・eatease.net認証） | **✅ 完了** |
| 3.7 | インフラ整備（Cloudflare Pages・ドメイン取得・リポジトリPrivate化） | **✅ 完了** |
| 3.8 | バーコードスキャン → 楽天・Amazonリンク | **✅ 完了** |
| 3.9 | 判定OK後マイリスト登録 + カタログデータ蓄積 | **✅ 完了** |
| 4 | テストユーザーフィードバック収集（9名）・楽天Amazonアフィリエイト実装 | **← 現在** |
| 5 | UIデザイン改善・集客 | 次 |
| 6 | サブスク課金（Stripe）・プラン管理 | ユーザー数を見て判断 |
| 7 | グレー確認フロー | 有料プランの核心機能 |
| 8 | マイリスト画面・カタログ検索画面 | 次フェーズ候補 |
| 9 | iOSアプリ化（バーコードスキャン実装時） | 将来 |
| 10 | App Store申請・リリース | 最終ゴール |

---

## ハマりポイント・トラブルシュート

| # | 問題 | 原因 | 解決策 |
|---|---|---|---|
| 1〜14 | Gemini・デプロイ系 | 旧バージョン参照 | 旧バージョン参照 |
| 15 | Email not confirmed | 確認メール未クリック | Dashboard → Auth → URL Configuration確認 |
| 16 | Email rate limit exceeded | Supabase無料プランは1時間4通制限 | Confirm emailをOFF・本番は外部SMTP |
| 17 | 残り回数が「？」・500エラー | `user_profiles`テーブル未作成 | SQL EditorでCREATE TABLE実行 |
| 18 | 既存ユーザーにプロファイルがない | トリガー設定前に登録 | `INSERT INTO user_profiles SELECT id FROM auth.users ON CONFLICT DO NOTHING` |
| 19 | 管理リンクが複数表示 | onAuthStateChangeが複数回発火 | ユーザー設定ページ内に管理リンクを移動 |
| 20 | user_settings テーブルがない | 未作成 | SQL EditorでCREATE TABLE実行 |
| 21 | 登録ボタンが表示されない | `renderDetailedResult()` が `renderResult()` を経由せず独自描画 | `renderDetailedResult()` 末尾に `showSaveButtonIfSafe()` を追加 |
| 22 | 解析前にconfirmダイアログが出る | 前回のgray判定結果が残った状態で新しい解析を開始 | 解析開始時に `save-to-mylist-area` を非表示・`_lastAnalysisResult` をリセット |
| 23 | 古いJS/CSSが配信される | Cloudflare キャッシュ | 該当ファイルの `?v=x.x.x` のバージョン番号を上げる |
| 24 | SQL EditorにペーストできないSupabase問題 | ブラウザのフォーカス問題 | エディタを一度クリックしてからペースト or 右クリック→貼り付け |
| 25 | 楽天APIで商品名が取得できない | 楽天に未登録の商品 | Open Food Facts APIにフォールバック |
| 26 | 楽天リンクがアフィリエイトにならない | itemUrlをそのまま使用 | RAKUTEN_AFFILIATE_IDで変換 |
| 27 | バーコードスキャンが遅い | showById()内で_stopBarcodeScanner()が呼ばれカメラ起動前に干渉 | バーコードページへの遷移はshowById()を使わず_ALL_PAGES.forEachで直接切替 |
| 28 | ドロワーメニューを閉じずにページ遷移 | closeDrawer()がIIFE外から呼べなかった | window.closeDrawerとして公開 |
| 29 | スマホでCSSのdisplay:noneが効かない | メディアクエリより後にdisplay:flexが定義されていた | 対象クラス定義の直後に!importantで上書き |
| 30 | 商品名が取得できない | DETAILED_IMAGE_PROMPTにproduct_name指示がなかった | DETAILED_IMAGE_PROMPTのJSON出力形式にproduct_nameフィールドを追加し、res.jsonにも含める |
| 31 | safeat-api.jsでproduct_nameが捨てられる | analyzeImageWithGeminiDetailedの返却値にproduct_nameが含まれていなかった | return文に product_name: data.product_name ?? null を追加 |

---

## コード肥大化への方針

2026-05-12時点で、フロントの段階的な分離は一通り実施済み。`web/safeat.js` は約58行まで縮小し、UI起動・タブ切替など最小限にしている。`web/safeat.css` も約1167行まで縮小し、認証モーダル・LP・ユーザー設定/マイリスト系CSSは別ファイルへ分離済み。

今後も「機能追加を続け、最後にまとめて全体修正する」方針は避ける。認証、画面遷移、カメラ、バーコード、Gemini解析、マイリスト保存が相互に絡んでいるため、最後に一括で直すと影響範囲が広くなり、不具合の原因特定も難しくなる。

今後は全面リライトではなく、動く状態を保ったまま段階的に整理する。ただし、現状は十分に分離が進んでいるため、必要のない分割は行わない。新機能追加やバグ修正で触る周辺だけ、既存挙動を変えない範囲で小さく整理する。

現在の主な分離済みファイル:

- `auth-ui.js`: 認証UI・ログイン/新規登録モーダル
- `page-utils.js`: 画面切替
- `navigation-ui.js`: ヘッダー/ドロワー/ページ遷移
- `mode-ui.js`: モード表示・モードバー
- `settings-ui.js`: ユーザー設定
- `image-ui.js`: 画像選択・切り抜き・カメラ
- `analysis-controller.js`: 解析実行制御・状態管理
- `result-ui.js`: 判定結果描画・フィードバック・保存ボタン表示
- `mylist-ui.js`: マイリスト・バーコード保存
- `user-db.js`: ブラウザ内ユーザー検証DB

基本方針は「今すぐ全体を作り直す」でも「最後に全部直す」でもなく、必要になった場所だけ小さく整えること。JS/CSSを修正した場合は、従来どおり `index.html` の該当 `?v=x.x.x` を更新する。CSS分割後は `safeat.css` 以外のCSSを直した場合も、そのCSSのクエリバージョンを上げる。

---

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

---

*最終更新: 2026-05-12（ローカル確認URLを http://localhost:5500/index.html に統一）*
