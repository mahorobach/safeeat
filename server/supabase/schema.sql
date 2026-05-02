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

-- ===== Phase 3: 月次スキャンカウント（profiles に追加） =====
-- Supabase SQL Editor で以下を実行してください
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS scan_month TEXT NOT NULL DEFAULT '';

-- トリガーを更新（新規ユーザー登録時に scan_month を初期化）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, scan_count, scan_month)
  VALUES (NEW.id, 0, to_char(now(), 'YYYY-MM'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
