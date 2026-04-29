# SafeEat — 食品成分チェッカー

食品の成分表を入力し、オリエンタルベジタリアン基準で成分の安全性を判定するアプリです。  
**フロント**は静的ファイル（GitHub Pages 等）、**API**は Node.js（Render 等）、データは **Supabase**、将来の課金は **Stripe** を想定した構成です。

## ターゲットユーザー

- **ベジタリアンを志す人**（これから菜食・段階的移行に興味がある層）
- **独身男性**
- **20〜30代**

UX・コピー・機能優先度（例: 手早い判定、ラベル読み取り、外出先での利用）はこの前提に寄せる。

---

## リポジトリ構成（実ディレクトリ）

```
SafeEat/
├── web/                          # 静的フロント（Pages にデプロイ）
│   ├── index.html
│   ├── site-config.js            # 公開可: API の URL（API_BASE）
│   ├── config.example.js         # 設定の説明・テンプレ（参照用）
│   ├── safeat.js                 # UI・ユーザー検証データ
│   ├── safeat-api.js             # POST /api/analyze クライアント
│   ├── safeat.css
│   └── lib/
│       ├── ingredients-db.js     # 成分ルール（JSON 相当を埋め込み・file:// 対応）
│       └── rules.js              # ローカル判定ロジック
├── server/                       # Node.js + Express API
│   ├── index.js
│   ├── package.json
│   ├── routes/
│   │   ├── analyze.js            # Claude テキスト / 画像（Vision）解析
│   │   ├── ingredients.js      # Supabase ingredients
│   │   ├── user.js
│   │   └── subscription.js       # Stripe Webhook 含む
│   ├── middleware/auth.js
│   └── supabase/
│       ├── client.js
│       └── schema.sql
├── shared/                       # 参照用（rules / JSON）。フロント実体は web/lib/ が優先
│   ├── ingredients-db.json
│   └── rules.js
├── xserver-php/                  # Xserver + MySQL 向け PHP（別系統・将来用）
│   ├── safeat-ingredients.php
│   ├── safeat-auth.php
│   ├── safeat-subscription.php
│   ├── schema.sql
│   └── .htaccess
├── .github/workflows/deploy-pages.yml
├── render.yaml                   # Render サービス定義（例）
├── .env.example                  # サーバー用環境変数テンプレート
└── README.md
```

ルートの `package.json` は歴史的な重複があり得ます。**API を動かすときは `server/package.json` を使います**（`cd server`）。

---

## デプロイ手順

### 1. バックエンド API（Render 例）

1. GitHub リポジトリを Render に接続する。
2. **Build Command:** `cd server && npm install`  
   **Start Command:** `node server/index.js`  
   （`render.yaml` を Blueprint として使う場合も同様のイメージです。）
3. ダッシュボードの **Environment** に下記「サーバー環境変数」をすべて設定する。  
   **`CLAUDE_API_KEY` は必須**（未設定だと `/api/analyze` が 500 になります）。
4. デプロイ後、表示された URL（例: `https://xxx.onrender.com`）をコピーする。

### 2. フロント（GitHub Pages）

- `main` へ push すると `.github/workflows/deploy-pages.yml` により `web/` と `shared/` がアップロードされます。
- **API の URL をフロントに反映する:** `web/site-config.js` の `API_BASE` を、手順 1 の API オリジンに合わせて変更してから push してください。

### 3. ローカルで API のみ起動

- Supabase の値をまだ入れていない場合でも **API プロセスは起動します**（`server/supabase/client.js` のプレースホルダ）。DB を使うルートは接続できません。
- **`CLAUDE_API_KEY` を export するか `.env` に書かないと**、`POST /api/analyze` は「APIキー未設定」で失敗します。

```bash
cd server
cp ../.env.example .env   # 値を編集
npm install
npm run dev
```

`server` 内で `.env` を読み込みます（`dotenv`）。CORS 用に `ALLOWED_ORIGINS` に `http://127.0.0.1:5500` などを入れてください。

### 4. ローカルでフロントのみ

- **Live Server 等の HTTP** 推奨（`file://` でも `web/lib` 埋め込みなら動きやすいです）。
- API を別ホストで動かす場合は `site-config.js` の `API_BASE` をその URL に合わせます。

---

## 環境変数一覧（サーバー / `server/.env`）

| 変数 | 必須 | 説明 |
|------|------|------|
| `CLAUDE_API_KEY` | **はい** | Anthropic API キー（**ブラウザに出さない**） |
| `SUPABASE_URL` | DB 利用時 | Supabase プロジェクト URL |
| `SUPABASE_ANON_KEY` | 認証・RLS 用 | 公開キー（サーバーがクライアント代理で使う場合など） |
| `SUPABASE_SERVICE_ROLE_KEY` | DB 管理用 | サービスロール（**秘匿**・サーバーのみ） |
| `STRIPE_SECRET_KEY` | 課金時 | Stripe シークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Webhook 時 | Stripe 署名検証用 |
| `ADMIN_EMAIL` | 任意 | 成分 verify など管理者判定に使うメール |
| `ALLOWED_ORIGINS` | 本番推奨 | CORS 許可オリジン（カンマ区切り）例: `https://xxx.github.io,http://localhost:5500` |
| `PORT` | 任意 | 未設定時は `3000`（Render は自動設定されることが多い） |

詳細なコメントは **`.env.example`** を参照してください。  
**Render** では `render.yaml` にキー名を列挙し、値はダッシュボードで `sync: false` として入力する運用が安全です。

---

## フロント設定とセキュリティ

- **Claude の API キーは `web/` に置かないでください。** 旧 `web/config.js` にキーを置く運用は廃止しました。
- **`web/site-config.js`** … コミット可。`API_BASE` のみ（公開してよいバックエンド URL）。
- **`web/config.example.js`** … テンプレと注意書き。フォーク時の参考用。
- **キーを誤ってコミット・共有した場合は、Anthropic コンソールで該当キーを無効化し、新しいキーを発行してください。**

---

## 判定の段階

| 表示 | 意味 |
|------|------|
| ✅ OK | 安全確定（ルール上） |
| 🟡 グレー | 由来など要確認 |
| ❌ NG | このモードでは不可 |
| 🔍 推測 | API が未知成分を推測。ユーザー正解は localStorage / ログイン時は Supabase へ |

---

## オリエンタルベジタリアン（要点）

- **NG:** 肉・魚介・五葷・コチニール（E120）・コラーゲン・ゼラチン・シェラック など  
- **OK:** 卵・乳製品・蜂蜜・ローヤルゼリー・大豆レシチン など  
- **グレー:** グリセリン・天然香料・酵素・由来不明のビタミンD など  

詳細は `web/lib/ingredients-db.js` およびサーバー側 `server/routes/analyze.js` のシステムプロンプトを参照してください。

---

## 開発フェーズ（目安）

| Phase | 内容 | 状態 |
|------|------|------|
| 1 | Web 入力 + API 経由で Claude 解析 | 実装済 |
| 2 | Supabase 成分 DB・ユーザー投稿 | ルート実装済 |
| 3 | 認証・ユーザー設定 | 随時 |
| 4 | Stripe サブスク | ルート・Webhook 枠あり |
| 5 | ネイティブアプリ等 | 将来 |
| — | `xserver-php/` | Xserver + MySQL 別ライン |

---

## MySQL（`xserver-php` 利用時）

PHP 側の設定例・テーブル定義は `xserver-php/schema.sql` および各 `safeat-*.php` を参照してください。Node 本線とは DB が異なります。

---

## ライセンス・連絡

プロジェクトポリシーに従ってください。
