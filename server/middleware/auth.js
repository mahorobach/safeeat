import { supabaseAdmin } from "../supabase/client.js";

/**
 * Supabase JWT を検証してリクエストにユーザー情報を付加するミドルウェア
 * 認証必須ルートに使用: router.use(requireAuth)
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: "認証が必要です" });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ ok: false, error: "トークンが無効または期限切れです" });
  }

  req.user = data.user;
  next();
}

/**
 * 認証オプション（ログインしていれば req.user を付加、未ログインでも通過）
 */
export async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    const { data } = await supabaseAdmin.auth.getUser(token);
    if (data?.user) req.user = data.user;
  }
  next();
}
