import { Router } from "express";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// 全ルートで認証必須
router.use(requireAuth);

// GET /api/user/profile — プロフィール + プラン情報
router.get("/profile", async (req, res, next) => {
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

// GET /api/user/settings — カスタム設定
router.get("/settings", async (req, res, next) => {
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

// PUT /api/user/settings — カスタム設定を保存・更新
router.put("/settings", async (req, res, next) => {
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

// POST /api/user/analysis — 解析履歴を保存（Premium プラン）
router.post("/analysis", async (req, res, next) => {
  const { ingredients_raw, result } = req.body;
  if (!ingredients_raw) {
    return res.status(400).json({ ok: false, error: "ingredients_raw は必須です" });
  }

  try {
    // 無料プランの日次上限チェック
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan, daily_count, count_reset_at")
      .eq("id", req.user.id)
      .single();

    const today = new Date().toISOString().slice(0, 10);
    const isNewDay = !profile.count_reset_at || profile.count_reset_at < today;
    const currentCount = isNewDay ? 0 : profile.daily_count;

    if (profile.plan === "free" && currentCount >= 5) {
      return res.status(429).json({
        ok: false,
        error: "無料プランの1日5回の上限に達しました。プレミアムプランにアップグレードしてください。",
        upgrade_required: true,
      });
    }

    // 履歴を保存
    const { error: histError } = await supabaseAdmin
      .from("analysis_history")
      .insert({ user_id: req.user.id, ingredients_raw, result_jsonb: result });

    if (histError) throw histError;

    // カウントを更新
    await supabaseAdmin
      .from("profiles")
      .update({
        daily_count: isNewDay ? 1 : currentCount + 1,
        count_reset_at: today,
      })
      .eq("id", req.user.id);

    res.json({ ok: true, remaining: profile.plan === "free" ? 5 - currentCount - 1 : null });
  } catch (e) {
    next(e);
  }
});

export default router;
