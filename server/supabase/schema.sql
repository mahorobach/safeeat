-- SafeEat — Supabase (PostgreSQL) スキーマ
-- Supabase ダッシュボードの SQL Editor に貼り付けて実行してください

-- ===== profiles（auth.users に連動） =====
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
  daily_count     INTEGER NOT NULL DEFAULT 0,
  count_reset_at  DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 新規ユーザー登録時に profiles を自動作成するトリガー
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== ingredients（成分判定DB） =====
CREATE TABLE IF NOT EXISTS public.ingredients (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('ok', 'gray', 'ng')),
  reason      TEXT,
  detail      TEXT,
  confidence  TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_name     ON public.ingredients (name);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON public.ingredients (category);
CREATE INDEX IF NOT EXISTS idx_ingredients_verified ON public.ingredients (verified);

-- updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ingredients_updated_at ON public.ingredients;
CREATE TRIGGER trg_ingredients_updated_at
  BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== user_settings（カスタム設定） =====
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL DEFAULT 'oriental',
  custom_ng  JSONB DEFAULT '[]'::JSONB,
  custom_ok  JSONB DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== subscriptions（Stripe サブスク） =====
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     SERIAL PRIMARY KEY,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due')),
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== analysis_history（解析履歴 — Premium） =====
CREATE TABLE IF NOT EXISTS public.analysis_history (
  id               SERIAL PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ingredients_raw  TEXT NOT NULL,
  result_jsonb     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_created ON public.analysis_history (user_id, created_at DESC);

-- ===== Row Level Security (RLS) =====

-- profiles: 本人のみ読み書き
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles
  USING (auth.uid() = id);

-- ingredients: 誰でも読める / 認証済みユーザーが追加可能
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ingredients_read"   ON public.ingredients FOR SELECT USING (true);
CREATE POLICY "ingredients_insert" ON public.ingredients FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- user_settings: 本人のみ
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_own" ON public.user_settings
  USING (auth.uid() = user_id);

-- subscriptions: 本人のみ
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_own" ON public.subscriptions
  USING (auth.uid() = user_id);

-- analysis_history: 本人のみ
ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_own" ON public.analysis_history
  USING (auth.uid() = user_id);

-- ===== Phase 3: ユーザープロファイル（モード拡張対応版） =====
-- Supabase SQL Editor で以下を順番に実行してください

-- 1. user_profiles テーブル
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro' | 'business'
  scan_count  INTEGER NOT NULL DEFAULT 0,     -- 今月の合算解析回数（全モード合計）
  scan_month  TEXT NOT NULL DEFAULT '',       -- 'YYYY-MM' 形式。月替わりでリセット判定に使う
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. スキャン履歴ログ（モード別に記録・将来の分析・課金設計用）
CREATE TABLE IF NOT EXISTS public.scan_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  diet_mode   TEXT NOT NULL DEFAULT 'oriental', -- 'oriental' | 'vegan' | 'halal' | 'lacto_ovo'
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. ingredient_cache に diet_mode 列を追加
ALTER TABLE public.ingredient_cache
  ADD COLUMN IF NOT EXISTS diet_mode TEXT NOT NULL DEFAULT 'oriental';

-- 4. ingredient_cache の主キーを (ingredient_hash, diet_mode) 複合に変更
--    ※ 既存データは全て diet_mode='oriental' となるため安全
ALTER TABLE public.ingredient_cache DROP CONSTRAINT IF EXISTS ingredient_cache_pkey;
ALTER TABLE public.ingredient_cache ADD PRIMARY KEY (ingredient_hash, diet_mode);

-- 5. 新規ユーザー登録時に user_profiles を自動生成するトリガー
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, plan, scan_count, scan_month)
  VALUES (NEW.id, 'free', 0, to_char(now(), 'YYYY-MM'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. RLS ポリシー
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own profile"
  ON public.user_profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users can update own profile"
  ON public.user_profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users can read own scan logs"
  ON public.scan_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users can insert own scan logs"
  ON public.scan_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ===== saved_products（マイリスト） =====
CREATE TABLE IF NOT EXISTS public.saved_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jan_code        TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  image_url       TEXT NOT NULL DEFAULT '',
  shop_url        TEXT NOT NULL DEFAULT '',
  diet_mode       TEXT NOT NULL DEFAULT 'oriental',
  analysis_result JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, jan_code)
);

CREATE INDEX IF NOT EXISTS idx_saved_products_user ON public.saved_products (user_id, created_at DESC);

ALTER TABLE public.saved_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_products_own_select" ON public.saved_products
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "saved_products_own_insert" ON public.saved_products
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_products_own_delete" ON public.saved_products
  FOR DELETE USING (auth.uid() = user_id);
