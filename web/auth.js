/**
 * EatEase — 認証クライアント（Supabase JS SDK v2 CDN版）
 * SUPABASE_URL・SUPABASE_ANON_KEY は web/site-config.js の SAFEAT_CONFIG に設定する
 * ANON_KEY は公開可（RLS で保護されている）
 */
(function () {
  "use strict";

  const cfg = window.SAFEAT_CONFIG || {};
  const url  = cfg.SUPABASE_URL;
  const key  = cfg.SUPABASE_ANON_KEY;

  if (!url || !key || typeof window.supabase?.createClient !== "function") {
    console.warn("[SafeEatAuth] Supabase が初期化できません。site-config.js または CDN を確認してください。");
    window.SafeEatAuth = null;
    return;
  }

  const _sb = window.supabase.createClient(url, key);

  window.SafeEatAuth = {
    /** @returns {Promise<{data, error}>} */
    signUp: (email, password) =>
      _sb.auth.signUp({ email, password }),

    /** @returns {Promise<{data, error}>} */
    signIn: (email, password) =>
      _sb.auth.signInWithPassword({ email, password }),

    /** @returns {Promise<{error}>} */
    signOut: () => _sb.auth.signOut(),

    /** @returns {Promise<Session|null>} */
    getSession: async () => {
      const { data } = await _sb.auth.getSession();
      return data.session ?? null;
    },

    /** @returns {Promise<User|null>} */
    getUser: async () => {
      const { data } = await _sb.auth.getUser();
      return data.user ?? null;
    },

    /** @returns {{ data: { subscription } }} */
    onAuthStateChange: (callback) =>
      _sb.auth.onAuthStateChange(callback),

    /** パスワードリセットメールを送信 */
    resetPassword: (email) =>
      _sb.auth.resetPasswordForEmail(email),
  };
})();
