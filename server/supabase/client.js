import { createClient } from "@supabase/supabase-js";
import ws from "ws";

/**
 * 本番は .env に必ず SUPABASE_* を設定すること。
 * 未設定時はダミー URL/キーでクライアントのみ生成し、プロセス起動を許可する（/api/analyze のローカル検証など）。
 * DB を触るルートは接続エラーになる。
 */
function envOr(key, fallback) {
  const v = process.env[key];
  return v != null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

const url = envOr("SUPABASE_URL", "https://placeholder-not-configured.supabase.co");
const anonKey = envOr("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig-placeholder");
const serviceKey = envOr(
  "SUPABASE_SERVICE_ROLE_KEY",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig-placeholder"
);

// anon key: 一般公開クエリ用（RLSで保護）
export const supabase = createClient(url, anonKey, {
  realtime: { transport: ws },
});

// service_role key: RLSをバイパスしてサーバー側でのみ使用
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});
