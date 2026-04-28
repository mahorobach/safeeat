import { Router } from "express";
import { supabaseAdmin } from "../supabase/client.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/ingredients — 全成分一覧（公開）
router.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("ingredients")
      .select("id, name, category, reason, detail, confidence, verified")
      .order("category")
      .order("name")
      .limit(2000);

    if (error) throw error;
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

// GET /api/ingredients/search?q=成分名 — 成分名で検索（公開）
router.get("/search", async (req, res, next) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ ok: true, data: [] });

  try {
    const { data, error } = await supabaseAdmin
      .from("ingredients")
      .select("id, name, category, reason, detail, confidence, verified")
      .ilike("name", `%${q}%`)
      .limit(50);

    if (error) throw error;
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/ingredients — 成分を追加・更新（要認証）
// ユーザーが推測成分の正解を登録するエンドポイント
router.post("/", requireAuth, async (req, res, next) => {
  const { name, category, reason, detail, confidence = "low" } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: "name は必須です" });
  }
  if (!["ok", "gray", "ng"].includes(category)) {
    return res.status(400).json({ ok: false, error: "category は ok/gray/ng のいずれか" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("ingredients")
      .upsert(
        {
          name: name.trim(),
          category,
          reason: reason || null,
          detail: detail || null,
          confidence,
          verified: false,        // 管理者が確認するまでは false
          submitted_by: req.user.id,
        },
        { onConflict: "name", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (error) throw error;
    res.json({ ok: true, id: data.id });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/ingredients/:id/verify — 成分を verified=true に更新（管理者のみ）
router.patch("/:id/verify", requireAuth, async (req, res, next) => {
  const adminEmail = process.env.ADMIN_EMAIL || "";
  if (req.user.email !== adminEmail) {
    return res.status(403).json({ ok: false, error: "管理者権限が必要です" });
  }

  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: "id が不正です" });

  try {
    const { error } = await supabaseAdmin
      .from("ingredients")
      .update({ verified: true })
      .eq("id", id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
