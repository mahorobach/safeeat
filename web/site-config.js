/**
 * SafeEat フロント用公開設定（コミット可）
 * API キー・秘匿情報はここに書かない。サーバー環境変数のみ。
 * SUPABASE_ANON_KEY は公開可（RLS で行レベルセキュリティが掛かっている）。
 */
window.SAFEAT_CONFIG = {
  /** バックエンド API のオリジン（末尾スラッシュなし） */
  API_BASE: "https://safeeat-production-b7c5.up.railway.app",

  /** Supabase — 公開設定（ANON_KEY は公開可） */
  SUPABASE_URL:      "https://gcbshohmtlglhrovtivf.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjYnNob2htdGxnbGhyb3Z0aXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2OTAwNzcsImV4cCI6MjA5MzI2NjA3N30.DP7XgDgvAe3Wy9KYh6nS8mYLiZhvDaIkiCqBpbdrWX4",
};
