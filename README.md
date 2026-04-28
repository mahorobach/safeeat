# SafeEat — 食品成分チェッカー

食品の成分表を入力し、オリエンタルベジタリアン基準で成分の安全性を判定するアプリ。

## フォルダ構成

```
safeat/
├── web/                        # Phase 1 Webアプリ
│   ├── index.html
│   ├── safeat.js               # UIロジック
│   ├── safeat.css              # レスポンシブスタイル
│   └── safeat-api.js           # Claude API通信（指数バックオフ付き）
├── server/                     # Phase 2-4: Xserver PHP API
│   ├── safeat-ingredients.php  # 成分DB読み書き（MySQL）
│   ├── safeat-auth.php         # ユーザー登録・ログイン（JWT）
│   └── safeat-subscription.php # Stripe Webhook・サブスク管理
├── android/                    # Phase 5 Androidアプリ（将来用）
├── ios/                        # Phase 5 iOSアプリ（将来用）
├── shared/
│   ├── ingredients-db.json     # 成分判定ルールDB（ローカル用）
│   └── rules.js                # 判定ロジック（Web・モバイル共通）
└── README.md
```

## 判定の3段階

| マーク | 意味 | 例 |
|---|---|---|
| ✅ OK | 安全確定 | 卵・乳製品・大豆レシチン |
| 🟡 グレー | 由来によって異なる | グリセリン・天然香料・酵素 |
| ❌ NG | 食べられない | 肉・魚・五葷・コチニール |
| 🔍 推測 | DBにない成分をClaudeが推測 | 信頼度: 低/中/高を表示 |

## オリエンタルベジタリアン 判定ルール

**❌ NG**: 肉類全般、魚介類全般、五葷（ニンニク・ネギ・ニラ・らっきょう・玉ねぎ）、コチニール色素（E120）、コラーゲン、ゼラチン、シェラック

**✅ OK**: 卵・卵黄・卵黄レシチン、乳製品全般、カゼイン、蜂蜜・ローヤルゼリー、大豆レシチン、乳酸、植物性油脂

**🟡 グレー**: グリセリン（植物性OK/動物性NG）、天然香料、酵素、ビタミンD（由来不明）

## 使い方（Phase 1）

1. [console.anthropic.com](https://console.anthropic.com/) でAPIキーを取得
2. `web/index.html` をブラウザで開く（VSCode Live Server 推奨）
3. APIキーを入力
4. 成分表を貼り付けて「成分を解析する」をクリック

## 開発フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | テキスト入力 + Claude API解析 | **実装済み** |
| 2 | PHP API + MySQL（成分DB蓄積） | ファイル作成済み |
| 3 | ユーザー登録・カスタム設定 | ファイル作成済み |
| 4 | Stripe サブスク（無料5回/日・有料無制限） | ファイル作成済み |
| 5 | Android / iOS アプリ + カメラ撮影 | 将来 |

## サーバー設定（Phase 2以降）

Xserver の `.env` または PHP の `getenv()` に以下を設定:

```
SAFEAT_DB_HOST=localhost
SAFEAT_DB_NAME=safeat_db
SAFEAT_DB_USER=safeat_user
SAFEAT_DB_PASS=your_password
SAFEAT_JWT_SECRET=your_jwt_secret
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## MySQL テーブル作成

```sql
CREATE TABLE ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
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
