-- SafeEat — MySQL スキーマ（Xserver）
-- 文字コード: utf8mb4（絵文字・日本語対応）

CREATE DATABASE IF NOT EXISTS safeat_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE safeat_db;

-- ===== 成分判定DB =====
CREATE TABLE IF NOT EXISTS ingredients (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE COMMENT '成分名（日本語）',
  category    ENUM('ok','gray','ng') NOT NULL COMMENT '判定カテゴリ',
  reason      TEXT COMMENT '判定理由',
  detail      TEXT COMMENT 'グレー成分の詳細説明',
  confidence  ENUM('high','medium','low') NOT NULL DEFAULT 'high',
  verified    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'ユーザーまたは管理者が正解確認済み',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name     (name),
  INDEX idx_category (category),
  INDEX idx_verified (verified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== ユーザー =====
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  plan          ENUM('free','premium') NOT NULL DEFAULT 'free',
  daily_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当日の解析回数（無料プラン上限管理）',
  count_reset_at DATE COMMENT '日次カウントリセット日',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== ユーザーカスタム設定 =====
CREATE TABLE IF NOT EXISTS user_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  mode       VARCHAR(50) NOT NULL DEFAULT 'oriental',
  custom_ng  JSON COMMENT 'カスタムNGカテゴリ配列',
  custom_ok  JSON COMMENT 'カスタムOK成分配列',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== サブスクリプション =====
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  user_id                INT NOT NULL,
  stripe_customer_id     VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  status                 ENUM('active','cancelled','past_due') NOT NULL DEFAULT 'active',
  current_period_end     TIMESTAMP,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_stripe_customer (stripe_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 解析履歴（Premium プラン） =====
CREATE TABLE IF NOT EXISTS analysis_history (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT,
  ingredients_raw TEXT NOT NULL COMMENT '入力成分テキスト（生）',
  result_json     JSON COMMENT '判定結果JSON',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
