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
│   │   ├── product.js            # バーコード商品検索・マイリスト
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

---

## 6. 現在のフロー（Gemini 1ステップ）

### 画像入力
1. 「📷 写真で読み取り」で画像を置く
2. 原材料の範囲を選択
3. `POST /api/analyze/gemini/image/detailed` → 判定表示

### テキスト入力
1. 成分テキストを入力
2. 「今すぐチェックする」→ `POST /api/analyze/gemini/text` → 判定表示

---

## 7. ユーザー認証（Phase 3 完了）

### 認証フロー

```
新規登録（メール＋パスワード）
  → Supabase Auth
  → on_auth_user_created トリガーで user_profiles を自動生成
  → JWTトークンを sessionStorage に保存
  → API呼び出し時に Authorization: Bearer <token> を付与
  → server/middleware/auth.js で検証
```

### 利用回数の設計思想

- **全モード合算で月10回**（シンプルさ優先）
- `scan_month`（YYYY-MM）と現在月を比較し、月替わりで自動リセット
- `scan_logs` にモード別ログを保存（将来の分析・課金設計のため）
- 将来ヴィーガン・ハラール等のモードを追加しても構造変更不要

### Supabaseテーブル

```sql
-- ユーザープロファイル
CREATE TABLE user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL DEFAULT 'free',
  scan_count  INTEGER NOT NULL DEFAULT 0,
  scan_month  TEXT NOT NULL DEFAULT '',       -- YYYY-MM形式
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- スキャン履歴ログ（将来の分析用）
CREATE TABLE scan_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  diet_mode   TEXT NOT NULL DEFAULT 'oriental',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### APIエンドポイント（実装済み）

```
GET  /api/user/me                      → ユーザー情報・残り回数（認証必須）
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
GET  /api/product/lookup               → バーコード商品情報検索（楽天API利用）
POST /api/product/save                 → マイリスト保存
GET  /api/product/mylist               → マイリスト取得
DELETE /api/product/mylist/:id         → マイリスト削除
GET  /api/subscription/status          → サブスク状態確認
POST /api/subscription/cancel          → サブスク解約
```

---

## 8. キャッシュ機能

- `/api/analyze/gemini/text`: SHA-256ハッシュでキャッシュ検索（ヒット時はGemini不使用）
- `/api/analyze/gemini/image/detailed`: OCR後テキストをキャッシュ保存（検索なし）
- **`ingredient_cache` の主キーは `(ingredient_hash, diet_mode)` の複合キー**
  - モードが違う成分は別エントリ。将来のモード追加に対応済み
- ハッシュ正規化は実装済み・再検討不要（analyze-gemini.js の hashIngredientText() 参照）

---

## 9. 環境変数一覧

| 変数 | 必須 | 説明 |
|------|------|------|
| `GEMINI_API_KEY` | **はい** | Google AI Studio（ブラウザに出さない） |
| `GEMINI_MODEL` | 推奨 | 例: `gemini-2.5-flash`（`models/`なし） |
| `SUPABASE_URL` | **はい** | SupabaseプロジェクトURL |
| `SUPABASE_ANON_KEY` | 認証用 | 公開キー（web/site-config.jsにも設定） |
| `SUPABASE_SERVICE_ROLE_KEY` | **はい** | サービスロール（秘匿・サーバーのみ） |
| `CLAUDE_API_KEY` | Claude利用時 | Anthropic APIキー（現在は予備） |
| `STRIPE_SECRET_KEY` | 課金時 | Stripeシークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Webhook時 | Stripe署名検証用 |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS許可オリジン（末尾スラッシュなし） |
| `PORT` | 任意 | 未設定時は3000 |

現在の ALLOWED_ORIGINS: `https://app.eatease.net,https://mahorobach.github.io`

`web/site-config.js` に設定するもの（公開可）：`SUPABASE_URL`・`SUPABASE_ANON_KEY`・`API_BASE`

---

## 10. 開発フェーズロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コア実証（写真→抽出→編集→判定） | **完了** |
| 2 | Gemini 1ステップ解析 + Supabaseキャッシュ | **完了** |
| 3 | ユーザー認証（Supabase Auth）・月10回制限・管理者ページ | **完了** |
| 3.5 | ランディングページ・モード選択・法的ページ | **完了** |
| 3.6 | メール設定（Resend・eatease.net認証） | **✅ 完了** |
| 3.7 | インフラ整備（Cloudflare Pages・ドメイン取得・GitHub Private化） | **✅ 完了** |
| 3.8 | バーコードスキャン → 楽天・Amazonリンク | **✅ 完了** |
| 4 | テストユーザー招待・フィードバック収集（9名） | **← 現在** |
| 5 | UIデザイン改善・集客 | 次 |
| 6 | サブスク課金（Stripe）・プラン管理 | ユーザー数を見て判断 |
| 7 | グレー確認フロー（有料プランの核心） | 有料プランの核心機能 |
| 8 | 判定履歴・お気に入り商品 | ユーザー体験向上 |
| 9 | iOSアプリ化（SwiftUI）※バーコード実装時 | App Store申請の前提 |
| 10 | App Store申請・リリース | 最終ゴール |
| 11 | Android対応 | 将来 |

### 収益方針

**まずユーザーを集めることを最優先。** 課金設計はユーザーが一定数集まってから判断する。

### プラン設計（暫定）

| 機能 | 無料（Free） | 有料（Pro） |
|---|---|---|
| スキャン回数 | 月10回（全モード合算） | 無制限 |
| 判定モード | オリエンタルベジのみ | 全モード＋カスタム |
| 履歴保存 | なし | あり |

---

## 11. ハマりポイント・トラブルシュート

| # | 問題 | 原因 | 解決策 |
|---|---|---|---|
| 1〜14 | （Gemini・デプロイ系） | README.md参照 | README.md参照 |
| 15 | Email not confirmed | 確認メールのリンク未クリック or リダイレクトURL設定ミス | Dashboard → Auth → URL Configuration確認 |
| 16 | Email rate limit exceeded | Supabase無料プランは1時間4通制限 | 開発中はConfirm emailをOFF・本番は外部SMTP |
| 17 | 残り回数が「？」・500エラー | `user_profiles` テーブルが未作成 | Supabase SQL EditorでCREATE TABLE実行 |
| 18 | 既存ユーザーにプロファイルがない | トリガー設定前に登録したユーザー | `INSERT INTO user_profiles SELECT id FROM auth.users ON CONFLICT DO NOTHING` |
| 19 | 管理リンクが複数表示 | onAuthStateChangeが複数回発火 | ユーザー設定ページ内に管理リンクを移動 |
| 20 | user_settings テーブルがない | 未作成 | SQL EditorでCREATE TABLE実行 |

---

## 12. 重要URL

| 項目 | URL |
|---|---|
| フロントエンド | https://app.eatease.net |
| 管理者ページ | https://app.eatease.net/admin.html |
| APIサーバー | https://safeeat-production-b7c5.up.railway.app |
| API死活確認 | https://safeeat-production-b7c5.up.railway.app/api/health |
| GitHubリポジトリ | https://github.com/mahorobach/safeeat（プライベート） |

---

## 13. サービス別アカウントメモ

| サービス | 備考 |
|---|---|
| Cloudflare | Dokakao@gmail.com / ドメイン: eatease.net / Pages: safeeat（app.eatease.net） |
| Railway | プロジェクト: safeeat |
| Supabase | Confirm email: ON / Sender: noreply@eatease.net / Site URL: https://app.eatease.net |
| Resend | ドメイン: eatease.net（認証済み） |
| GitHub | mahorobach/safeeat（プライベート） |

---

*作成日：2026年4月28日*
*最終更新：2026年5月9日（ブランド名をVegeEatEaseに変更・Cloudflare Pages移行・メール設定完了・バーコード機能追加・tester9名付与・URL全面更新）*
