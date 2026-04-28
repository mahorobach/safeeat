import { createClient } from "@supabase/supabase-js";

// anon key: 一般公開クエリ用（RLSで保護）
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// service_role key: RLSをバイパスしてサーバー側でのみ使用
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
