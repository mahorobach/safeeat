# SafeEat — 食品成分チェッカー

食品の成分表を入力し、食事スタイル別に成分の安全性を判定するWebアプリ。  
現在は**オリエンタルベジタリアン**基準に特化。将来は複数モード・多言語対応予定。

---

## ターゲットユーザー

- ベジタリアンを志す人（段階的移行を含む）
- 独身男性 / 20〜30代
- 外出先での手早い判定・ラベル読み取りを重視

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / JavaScript（静的） |
| バックエンド | Node.js / Express |
| データベース | Supabase（PostgreSQL） |
| 認証 | Supabase Auth |
| AI解析（現在） | Claude API（`claude-sonnet-4-5` 系、環境変数で切替可） |
| AI解析（計画中） | Gemini 1.5 Flash（OCR）+ Claude（判定） |
| フロントホスティング | GitHub Pages |
| APIホスティング | Railway（本番） |
| ソース管理 | GitHub |
| 決済（将来） | Stripe |
| 本番移行先（将来） | Xserver（PHP + MySQL） |

---

## リポジトリ構成

```
SafeEat/
├── web/                          # 静的フロント（GitHub Pages にデプロイ）
│   ├── index.html
│   ├── site-config.js            # コミット可: API_BASE のみ
│   ├── config.example.js         # 設定テンプレ（参照用）
│   ├── safeat.js                 # UI操作・ユーザー検証データのみ
│   ├── safeat-api.js             # POST /api/analyze クライアント
│   ├── safeat.css
│   └── lib/
│       ├── ingredients-db.js     # 成分ルール（インライン・file:// 対応）
│       └── rules.js              # ローカル判定ロジック（shared/rules.js と同一内容）
├── server/                       # Node.js + Express（Railway にデプロイ）
│   ├── index.js
│   ├── package.json              # API を動かすときはこちらを使う（cd server）
│   ├── routes/
│   │   ├── analyze.js            # Claude テキスト/画像解析・プロンプト管理
│   │   ├── ingredients.js        # Supabase ingredients CRUD
│   │   ├── user.js               # ユーザー情報・設定
│   │   └── subscription.js       # Stripe Webhook 含む
│   ├── middleware/auth.js        # Supabase JWT 認証
│   └── supabase/
│       ├── client.js
│       └── schema.sql            # PostgreSQL スキーマ + RLS ポリシー
├── shared/                       # 共通ロジック（Node.js + ブラウザ両対応）
│   ├── ingredients-db.json       # 成分マスタDB
│   └── rules.js                  # 判定ロジック正規版（web/lib/rules.js の元）
├── xserver-php/                  # 将来の Xserver 移行用（保存のみ）
│   ├── safeat-ingredients.php
│   ├── safeat-auth.php
│   ├── safeat-subscription.php
│   ├── schema.sql
│   └── .htaccess
├── docs/                         # 追加設計資料置き場
├── .github/workflows/deploy-pages.yml
├── render.yaml                   # Render 向け定義（参考用）
├── .env.example                  # 環境変数テンプレート
├── CLAUDE.md                     # Claude Code 向け最小ルール
└── README.md                     # このファイル
```

---

## アーキテクチャ方針

### 3層レイヤード構造

```
┌──────────────────────────────────────────┐
│  UI層  web/safeat.js / index.html        │
│  → 表示とユーザー操作のみ                 │
│  → Claude API を直接呼んではいけない      │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│  ロジック層  shared/rules.js             │
│  → 判定ルール・モード別分岐を一元管理     │
│  → UI にも DB にも依存しない             │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│  データ層  server/routes / Supabase      │
│  → 外部サービスとの通信のみ              │
│  → 判定ロジックをここに書かない          │
└──────────────────────────────────────────┘
```

### 絶対ルール（コード生成・修正時も必ず守ること）

| ルール | 理由 |
|---|---|
| UI層から Claude API を直接呼ばない | APIキー漏洩防止 |
| APIキーを `web/` に置かない | `CLAUDE_API_KEY` はサーバー環境変数のみ |
| `safeat.js` は UI操作のみ | ビジネスロジックをUIに混在させない |
| ロジック層は UI にも DB にも import しない | 層の独立性・テスト・移植を容易にする |

---

## 現在のフロー（Claude 2段ステップ）

写真から成分を扱うときは **読み取りのみ → テキストで判定** が必須。タイムアウト・切断・大きなJSONレスポンスを避けるための設計。

### ユーザー操作

1. **「📷 写真で読み取り」** で画像を置く
2. **✂ 原材料の範囲を選択**（パッケージ全体を送ると失敗しやすい）
3. **「この画像で読み取る」** → `POST /api/analyze` with `{ type: "image", extractOnly: true }` → テキストエリアに抽出結果が入る
4. **テキストを確認・修正**する
5. **「成分を解析する」** → `POST /api/analyze` with `{ ingredients: "..." }` → 判定表示

### API エンドポイント

| エンドポイント | 用途 |
|---|---|
| `POST /api/analyze` with `type: "image"`, `extractOnly: true` | 画像から成分テキスト抽出のみ |
| `POST /api/analyze` with `ingredients` | テキストから成分判定 |
| `POST /api/analyze/image` | 1リクエストで抽出→判定（サーバー内部は2段） |

**`type: "image"` かつ `extractOnly` なしのワンショット判定は廃止（400エラー）。**

---

## 計画中アーキテクチャ（Gemini OCR 試験導入）

> **ステータス: 試験中・未確定**  
> 現在の Claude 2段ステップと並行して検証予定。

### ハイブリッドモデル戦略

| プロセス | モデル案 | 役割 |
|---|---|---|
| **抽出（OCR）** | Gemini 1.5 Flash | 座標（Bounding Box）・確信度の取得。低コスト |
| **判定** | Claude Sonnet | オリエンタルベジタリアン判定。複雑な文脈理解 |

### Gemini 1ステップ案も検討中

Gemini が成分テキスト抽出と構造化を1回のリクエストで返す方式。精度・コスト・実装コストを現行2段方式と比較して採否を決定する。

### 精度担保機能（Gemini 導入時）

- **信頼度の可視化**: 各成分の確信度（0.0〜1.0）を背景色で表示
- **座標連動ハイライト**: 抽出テキストをクリックすると元画像の該当箇所を枠表示（ハルシネーション検出）
- **抽出プロンプトの純粋化**: 抽出フェーズでは「ベジタリアン判定」文脈を与えない

### キャッシュ戦略（Gemini 導入後の収益モデル）

- 正規化テキストのハッシュ値で Supabase を検索
- 一度解析した成分は次回 API コスト0円で提供
- 利用者が増えるほど利益率が向上

---

## 判定ルール（オリエンタルベジタリアン）

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
| 乳酸 | OK（とりあえず許容）|
| 植物性油脂全般 | 植物性 |
| アサフェティダ | 五葷の代替スパイス |

### 🟡 グレー（由来要確認）

| 成分 | 理由 |
|---|---|
| グリセリン | 植物性ならOK / 動物性油脂由来ならNG |
| 香料（天然） | 植物性OK / 動物性ムスク等含む可能性あり |
| 酵素 | 微生物・植物性OK / 動物性はNG |
| ビタミンD（由来不明） | キノコ由来OK / 由来不明はグレー |

### 判定の表示段階

| 表示 | 意味 |
|---|---|
| ✅ OK | 安全確定（ルール上） |
| 🟡 グレー | 由来など要確認 |
| ❌ NG | このモードでは不可 |
| 🔍 推測 | API が未知成分を推測。ユーザー正解は localStorage / ログイン時は Supabase へ |

成分ルールの詳細は `web/lib/ingredients-db.js`・`shared/ingredients-db.json` および `server/routes/analyze.js` のシステムプロンプトを参照。

---

## デプロイ手順

### 本番構成

| 役割 | URL |
|---|---|
| フロントエンド | `https://mahorobach.github.io/safeeat/web/index.html` |
| APIサーバー | `https://safeeat-production-b7c5.up.railway.app` |
| API死活確認 | `https://safeeat-production-b7c5.up.railway.app/api/health` |
| GitHubリポジトリ | `https://github.com/mahorobach/safeeat` |

### 1. バックエンド API（Railway）

1. GitHub リポジトリを Railway に接続する。
2. **Root Directory:** `server`  
   **Start Command:** `node index.js`
3. Railway の Variables に「環境変数一覧」をすべて設定する。**`CLAUDE_API_KEY` は必須**。
4. デプロイ後の URL を `web/site-config.js` の `API_BASE` に反映する。

### 2. フロント（GitHub Pages）

- `main` へ push すると `.github/workflows/deploy-pages.yml` により `web/` と `shared/` が自動デプロイされる。
- API URL を変更した場合は `web/site-config.js` の `API_BASE` を更新してから push。

### 3. ローカルで API のみ起動

```bash
cd server
cp ../.env.example .env   # 値を編集
npm install
npm run dev
```

`ALLOWED_ORIGINS` に `http://127.0.0.1:5500` などローカルオリジンを追加すること。

### 4. ローカルでフロントのみ

Live Server 等の HTTP 推奨。`web/site-config.js` の `API_BASE` を動かしているAPIのURLに合わせる。

---

## 環境変数一覧（`server/.env`）

| 変数 | 必須 | 説明 |
|------|------|------|
| `CLAUDE_API_KEY` | **はい** | Anthropic API キー（**ブラウザに出さない**） |
| `GEMINI_API_KEY` | Gemini 利用時 | Google AI Studio で取得（未設定時は Gemini エンジン選択で 500） |
| `SUPABASE_URL` | DB 利用時 | Supabase プロジェクト URL |
| `SUPABASE_ANON_KEY` | 認証・RLS 用 | 公開キー |
| `SUPABASE_SERVICE_ROLE_KEY` | DB 管理用 | サービスロール（**秘匿**・サーバーのみ） |
| `STRIPE_SECRET_KEY` | 課金時 | Stripe シークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Webhook 時 | Stripe 署名検証用 |
| `ADMIN_EMAIL` | 任意 | 管理者判定に使うメール |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS 許可オリジン（カンマ区切り、末尾スラッシュなし） |
| `PORT` | 任意 | 未設定時は `3000` |
| `CLAUDE_MODEL` | 任意 | テキスト判定モデル（未設定時はデフォルト） |
| `CLAUDE_IMAGE_EXTRACT_MODEL` | 任意 | 画像抽出モデル（未設定時は `CLAUDE_MODEL` と同じ） |
| `CLAUDE_TEMPERATURE` | 任意 | 温度パラメータ |

テンプレートは `.env.example` 参照。

---

## セキュリティ設計

- **APIキーはすべてサーバー側（Railway の Variables）に保持**
- `web/` にAPIキーは一切置かない（`web/site-config.js` は `API_BASE` のみ）
- `.env` は `.gitignore` で除外（`.env.example` のみ管理）
- Supabase RLS ポリシーで「自分のデータのみ読み書き可能」を全テーブルに設定
- **キーを誤ってコミットした場合は Anthropic コンソールで即時無効化・再発行**

---

## 開発フェーズロードマップ

### 現状フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | コア実証（写真→抽出→編集→判定） | **完了** |
| 2 | Supabase 成分DB・ユーザー投稿ルート | ルート実装済 |
| 3 | 認証・ユーザー設定・判定履歴 | 随時 |
| 4 | Stripe サブスク（無料5回/日・有料無制限） | ルート・Webhook 枠あり |
| 5 | Android / iPhone・バーコードスキャン | 将来 |

### 技術ロードマップ

| 段階 | テーマ |
|---|---|
| 現在 | Gemini OCR 試験・1ステップ vs 2ステップ比較 |
| 次 | エラー分類・メッセージ統一・ログ整備 |
| 以降 | 成分正規化・キャッシュ・コスト最適化 |
| 将来 | 食事モード拡張（ビーガン等）・多言語対応 |
| 最終 | レート制限・モデル最終選定（現在は環境変数で差替可能） |

### 将来のモード拡張（`shared/rules.js` にストラテジーパターンで追加予定）

```javascript
// shared/rules.js のイメージ
const MODES = {
  oriental: new OrientalVegetarianStrategy(),  // Phase 1（現在）
  vegan:    new VeganStrategy(),               // 将来
  lactoOvo: new LactoOvoStrategy(),            // 将来
  custom:   new CustomStrategy(userSettings),  // 将来
};
```

新モードを追加するときは新クラスを追加するだけ。既存コードは変更しない。

---

## MySQL テーブル設計（`xserver-php` 移行時）

```sql
CREATE TABLE ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category ENUM('ok','gray','ng') NOT NULL,
  reason TEXT,
  confidence ENUM('high','medium','low') DEFAULT 'high',
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  plan ENUM('free','premium') DEFAULT 'free',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  mode VARCHAR(50) DEFAULT 'oriental',
  custom_ng TEXT,
  custom_ok TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  status ENUM('active','cancelled','past_due') DEFAULT 'active',
  current_period_end TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Node 本線（Supabase）とは DB が異なる。スキーマ詳細は `xserver-php/schema.sql` 参照。

---

## ハマりポイント・トラブルシュート

| # | 問題 | 原因 | 解決策 |
|---|---|---|---|
| 1 | push できない | token に workflow スコープなし | Classic token で repo + workflow を選択 |
| 2 | push できない | 古い token がキャッシュされる | git remote 削除→再登録 |
| 3 | Build エラー | package.json がルートにない | `server/` からルートにコピー |
| 4 | `server/server/index.js` エラー | Root Directory + Start Command でパス二重 | Start Command を `node index.js` に修正 |
| 5 | supabaseKey required | 環境変数3つが未設定 | Variables に追加 |
| 6 | CORS エラー | `ALLOWED_ORIGINS` にオリジンが未登録 | 末尾スラッシュなしで追加 |
| 7 | GitHub Pages 404 | Actions が未実行 | 空コミットでトリガー |
| 8 | API タイムアウト | 画像が大きすぎる / ワンショット判定 | extractOnly フローに切替・画像を範囲選択 |

---

*最終更新: 2026-05-02*
