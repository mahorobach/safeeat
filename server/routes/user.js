import { Router } from "express";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

const router = Router();
const FREE_PLAN_LIMIT = 10;

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// GET /api/user/me — ログインユーザー情報（認証必須）
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("plan, scan_count, scan_month")
      .eq("id", req.user.id)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    const month     = currentMonth();
    const used      = (data?.scan_month === month ? data?.scan_count : 0) || 0;
    const limit     = FREE_PLAN_LIMIT;
    const remaining = Math.max(0, limit - used);

    res.json({
      ok: true,
      data: {
        email: req.user.email,
        plan: data?.plan || "free",
        used,
        limit,
        remaining,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/user/scan-count — スキャン残り回数（未ログインも可）
router.get("/scan-count", optionalAuth, async (req, res, next) => {
  if (!req.user) {
    return res.json({ ok: true, used: 0, limit: FREE_PLAN_LIMIT, remaining: FREE_PLAN_LIMIT });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("plan, scan_count, scan_month")
      .eq("id", req.user.id)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    const month     = currentMonth();
    const used      = (data?.scan_month === month ? data?.scan_count : 0) || 0;
    const limit     = FREE_PLAN_LIMIT;
    const remaining = Math.max(0, limit - used);

    res.json({ ok: true, used, limit, remaining });
  } catch (e) {
    next(e);
  }
});

// POST /api/user/scan-count/increment — スキャン回数を +1（認証必須）
router.post("/scan-count/increment", requireAuth, async (req, res, next) => {
  try {
    const month = currentMonth();
    const { data } = await supabaseAdmin
      .from("user_profiles")
      .select("scan_count, scan_month")
      .eq("id", req.user.id)
      .single();

    const newCount = data?.scan_month === month ? (data?.scan_count || 0) + 1 : 1;
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ scan_count: newCount, scan_month: month })
      .eq("id", req.user.id);

    if (error) throw error;

    const remaining = Math.max(0, FREE_PLAN_LIMIT - newCount);
    res.json({ ok: true, used: newCount, limit: FREE_PLAN_LIMIT, remaining });
  } catch (e) {
    next(e);
  }
});

// GET /api/user/profile — プロフィール（認証必須・旧 profiles テーブル）
router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("plan, daily_count, count_reset_at")
      .eq("id", req.user.id)
      .single();

    if (error) throw error;
    res.json({ ok: true, data: { email: req.user.email, ...data } });
  } catch (e) {
    next(e);
  }
});

// GET /api/user/settings — カスタム設定（認証必須）
router.get("/settings", requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_settings")
      .select("mode, custom_ng, custom_ok")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    res.json({ ok: true, data: data || { mode: "oriental", custom_ng: [], custom_ok: [] } });
  } catch (e) {
    next(e);
  }
});

// PUT /api/user/settings — カスタム設定を保存（認証必須）
router.put("/settings", requireAuth, async (req, res, next) => {
  const { mode = "oriental", custom_ng = [], custom_ok = [] } = req.body;

  const validModes = ["oriental", "vegan", "lacto_ovo", "custom"];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ ok: false, error: "mode が不正です" });
  }

  try {
    const { error } = await supabaseAdmin
      .from("user_settings")
      .upsert(
        { user_id: req.user.id, mode, custom_ng, custom_ok, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/user/analysis — 解析履歴を保存（認証必須）
router.post("/analysis", requireAuth, async (req, res, next) => {
  const { ingredients_raw, result } = req.body;
  if (!ingredients_raw) {
    return res.status(400).json({ ok: false, error: "ingredients_raw は必須です" });
  }

  try {
    const { error: histError } = await supabaseAdmin
      .from("analysis_history")
      .insert({ user_id: req.user.id, ingredients_raw, result_jsonb: result });

    if (histError) throw histError;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
